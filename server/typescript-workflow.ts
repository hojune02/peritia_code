import type ts from "typescript";
import type { SourceFile } from "../lib/repository";
import {
  indexWorkflowSource,
  type WorkflowCall,
  type WorkflowDefinitionIndex,
  type WorkflowFileIndex,
} from "../lib/control-flow";

const typeScriptFamilyExtensions = /\.(?:[cm]?[jt]sx?)$/i;
type TypeScriptCompiler = typeof ts;
let compilerPromise: Promise<TypeScriptCompiler> | null = null;

type AstDefinition = {
  node: ts.Node;
  body: ts.Node;
  index: WorkflowDefinitionIndex;
};

function loadCompiler() {
  compilerPromise ??= import("typescript").then((module) => module as TypeScriptCompiler);
  return compilerPromise;
}

function scriptKind(compiler: TypeScriptCompiler, path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "tsx") return compiler.ScriptKind.TSX;
  if (extension === "jsx") return compiler.ScriptKind.JSX;
  if (["js", "mjs", "cjs"].includes(extension ?? "")) return compiler.ScriptKind.JS;
  return compiler.ScriptKind.TS;
}

function lineAt(source: ts.SourceFile, position: number) {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function propertyName(
  compiler: TypeScriptCompiler,
  name: ts.PropertyName | ts.BindingName | undefined,
) {
  if (!name) return null;
  if (compiler.isIdentifier(name) || compiler.isPrivateIdentifier(name)) return name.text;
  if (compiler.isStringLiteral(name) || compiler.isNumericLiteral(name)) return name.text;
  return null;
}

function hasModifier(compiler: TypeScriptCompiler, node: ts.Node, kind: ts.SyntaxKind) {
  return compiler.canHaveModifiers(node)
    && Boolean(compiler.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function isExternallyVisible(compiler: TypeScriptCompiler, node: ts.Node, name: string) {
  if (["main", "handler", "run", "start"].includes(name.toLowerCase())) return true;
  if (
    hasModifier(compiler, node, compiler.SyntaxKind.ExportKeyword)
    || hasModifier(compiler, node, compiler.SyntaxKind.DefaultKeyword)
    || hasModifier(compiler, node, compiler.SyntaxKind.PublicKeyword)
  ) return true;

  if (
    compiler.isVariableDeclaration(node)
    || compiler.isPropertyDeclaration(node)
    || compiler.isPropertyAssignment(node)
  ) {
    let parent: ts.Node | undefined = node.parent;
    while (parent && !compiler.isSourceFile(parent)) {
      if (
        hasModifier(compiler, parent, compiler.SyntaxKind.ExportKeyword)
        || hasModifier(compiler, parent, compiler.SyntaxKind.DefaultKeyword)
        || hasModifier(compiler, parent, compiler.SyntaxKind.PublicKeyword)
      ) return true;
      if (compiler.isFunctionLike(parent)) break;
      parent = parent.parent;
    }
  }

  if (
    (compiler.isMethodDeclaration(node) || compiler.isGetAccessorDeclaration(node)
      || compiler.isSetAccessorDeclaration(node) || compiler.isConstructorDeclaration(node))
    && node.parent
    && (compiler.isClassDeclaration(node.parent) || compiler.isClassExpression(node.parent))
  ) {
    return hasModifier(compiler, node.parent, compiler.SyntaxKind.ExportKeyword)
      || hasModifier(compiler, node.parent, compiler.SyntaxKind.DefaultKeyword);
  }

  return false;
}

function callName(compiler: TypeScriptCompiler, expression: ts.Expression) {
  if (compiler.isIdentifier(expression)) return expression.text;
  if (compiler.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    compiler.isElementAccessExpression(expression)
    && expression.argumentExpression
    && (compiler.isStringLiteral(expression.argumentExpression)
      || compiler.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) return expression.argumentExpression.text;
  return null;
}

function definition(
  compiler: TypeScriptCompiler,
  source: ts.SourceFile,
  node: ts.Node,
  body: ts.Node | undefined,
  name: string | null,
): AstDefinition | null {
  if (!body || !name) return null;
  const start = node.getStart(source);
  const end = Math.max(start, node.end - 1);
  return {
    node,
    body,
    index: {
      name,
      line: lineAt(source, start),
      endLine: lineAt(source, end),
      exported: isExternallyVisible(compiler, node, name),
      calls: [],
    },
  };
}

function collectDefinitions(compiler: TypeScriptCompiler, source: ts.SourceFile) {
  const definitions: AstDefinition[] = [];

  function visit(node: ts.Node) {
    let found: AstDefinition | null = null;
    if (compiler.isFunctionDeclaration(node)) {
      found = definition(compiler, source, node, node.body, propertyName(compiler, node.name));
    } else if (compiler.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      if (initializer && (compiler.isArrowFunction(initializer) || compiler.isFunctionExpression(initializer)))
        found = definition(compiler, source, node, initializer.body, propertyName(compiler, node.name));
    } else if (compiler.isPropertyDeclaration(node) || compiler.isPropertyAssignment(node)) {
      const initializer = node.initializer;
      if (initializer && (compiler.isArrowFunction(initializer) || compiler.isFunctionExpression(initializer)))
        found = definition(compiler, source, node, initializer.body, propertyName(compiler, node.name));
    } else if (
      compiler.isMethodDeclaration(node)
      || compiler.isGetAccessorDeclaration(node)
      || compiler.isSetAccessorDeclaration(node)
    ) {
      found = definition(compiler, source, node, node.body, propertyName(compiler, node.name));
    } else if (compiler.isConstructorDeclaration(node)) {
      found = definition(compiler, source, node, node.body, "constructor");
    } else if (
      compiler.isFunctionExpression(node)
      && node.name
      && !(compiler.isVariableDeclaration(node.parent) || compiler.isPropertyDeclaration(node.parent)
        || compiler.isPropertyAssignment(node.parent))
    ) {
      found = definition(compiler, source, node, node.body, node.name.text);
    }

    if (found) definitions.push(found);
    compiler.forEachChild(node, visit);
  }

  visit(source);
  return definitions;
}

function collectCalls(
  compiler: TypeScriptCompiler,
  source: ts.SourceFile,
  owner: AstDefinition,
  definitions: AstDefinition[],
) {
  const calls: WorkflowCall[] = [];
  const nestedDefinitions = new Set(
    definitions.filter((candidate) => candidate !== owner).map((candidate) => candidate.node),
  );

  function visit(node: ts.Node) {
    if (nestedDefinitions.has(node)) return;
    if (compiler.isCallExpression(node) || compiler.isNewExpression(node)) {
      const name = callName(compiler, node.expression);
      if (name) calls.push({ name, line: lineAt(source, node.expression.getStart(source)) });
    }
    compiler.forEachChild(node, visit);
  }

  visit(owner.body);
  return calls;
}

export function isTypeScriptWorkflowPath(path: string) {
  return typeScriptFamilyExtensions.test(path);
}

export async function indexTypeScriptWorkflowSource(file: SourceFile): Promise<WorkflowFileIndex> {
  const compiler = await loadCompiler();
  const source = compiler.createSourceFile(
    file.path,
    file.content,
    compiler.ScriptTarget.Latest,
    true,
    scriptKind(compiler, file.path),
  );
  const definitions = collectDefinitions(compiler, source);
  for (const item of definitions)
    item.index.calls = collectCalls(compiler, source, item, definitions);
  return { path: file.path, definitions: definitions.map((item) => item.index) };
}

/**
 * TypeScript-family files use the compiler AST. Other supported languages keep
 * the conservative regex analyzer until their own parser is introduced.
 */
export async function indexWorkflowSourceWithAst(file: SourceFile): Promise<WorkflowFileIndex> {
  if (!isTypeScriptWorkflowPath(file.path)) return indexWorkflowSource(file);
  try {
    return await indexTypeScriptWorkflowSource(file);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "typescript_workflow_parse_failed",
      path: file.path,
      error: error instanceof Error ? error.message : "UNKNOWN",
    }));
    return indexWorkflowSource(file);
  }
}
