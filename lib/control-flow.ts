import type { Guide, SourceFile } from "./repository";

export type FlowNode = {
  id: string;
  name: string;
  path: string;
  line: number;
  endLine: number;
  exported: boolean;
  incoming: number;
  outgoing: number;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  callLine: number;
  evidence: "call reference";
};

export type ControlFlow = {
  id: string;
  label: string;
  rootId: string;
  nodeIds: string[];
  edgeIds: string[];
};

export type ControlFlowMap = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  flows: ControlFlow[];
  unresolvedCalls: number;
  inspectedFiles: number;
  visibleSourceFiles: number;
};

type Definition = Omit<FlowNode, "incoming" | "outgoing"> & {
  source: string[];
};

const ignoredCalls = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "throw",
  "typeof", "sizeof", "new", "super", "this", "class", "def", "fn", "func",
  "print", "console", "log", "require", "import", "include", "assert", "await",
]);

const codeExtensions = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|cs|php|rb|swift|c|cc|cpp|h|hpp)$/i;

function definitionAt(line: string) {
  const patterns: Array<{ expression: RegExp; group?: number }> = [
    { expression: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { expression: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { expression: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/ },
    { expression: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/ },
    { expression: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/ },
    { expression: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|override\s+|suspend\s+)*(?:[A-Za-z_$][\w$<>,.?\[\]]*\s+)+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^={]+)?\{/ },
    { expression: /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)\s*\(/ },
    { expression: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)\b/ },
  ];
  for (const { expression } of patterns) {
    const match = expression.exec(line);
    if (match && !ignoredCalls.has(match[1])) return match[1];
  }
  return null;
}

function definitionsIn(file: SourceFile): Definition[] {
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  const starts: Array<{ name: string; index: number }> = [];
  lines.forEach((line, index) => {
    const name = definitionAt(line);
    if (name) starts.push({ name, index });
  });
  return starts.map((item, index) => {
    const next = starts[index + 1]?.index ?? lines.length;
    const exported = /\bexport\b|\bpublic\b|^\s*pub\b/.test(lines[item.index])
      || ["main", "handler", "run", "start"].includes(item.name.toLowerCase());
    return {
      id: `${file.path}:${item.index + 1}:${item.name}`,
      name: item.name,
      path: file.path,
      line: item.index + 1,
      endLine: Math.max(item.index + 1, next),
      exported,
      source: lines.slice(item.index, next),
    };
  });
}

function callsIn(definition: Definition) {
  const calls: Array<{ name: string; line: number }> = [];
  definition.source.forEach((sourceLine, offset) => {
    const line = sourceLine
      .replace(/\/\/.*$/, "")
      .replace(/#.*$/, "")
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "");
    for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1];
      if (!ignoredCalls.has(name) && !(offset === 0 && name === definition.name))
        calls.push({ name, line: definition.line + offset });
    }
  });
  return calls;
}

function reachable(rootId: string, edges: FlowEdge[], maxNodes = 24) {
  const found = new Set<string>();
  const queue = [rootId];
  while (queue.length && found.size < maxNodes) {
    const current = queue.shift()!;
    if (found.has(current)) continue;
    found.add(current);
    for (const edge of edges) if (edge.from === current && !found.has(edge.to)) queue.push(edge.to);
  }
  return [...found];
}

export function buildControlFlowMap(guide: Pick<Guide, "files" | "sources">): ControlFlowMap {
  const sourceFiles = guide.sources.filter((file) => codeExtensions.test(file.path));
  const definitions = sourceFiles.flatMap(definitionsIn);
  const byName = new Map<string, Definition[]>();
  definitions.forEach((definition) => {
    byName.set(definition.name, [...(byName.get(definition.name) ?? []), definition]);
  });

  const edges: FlowEdge[] = [];
  let unresolvedCalls = 0;
  const seen = new Set<string>();
  for (const definition of definitions) {
    for (const call of callsIn(definition)) {
      const candidates = byName.get(call.name) ?? [];
      const sameFile = candidates.filter((candidate) => candidate.path === definition.path);
      const target = sameFile.length === 1 ? sameFile[0] : candidates.length === 1 ? candidates[0] : null;
      if (!target) {
        if (candidates.length !== 0 || !ignoredCalls.has(call.name)) unresolvedCalls++;
        continue;
      }
      const key = `${definition.id}->${target.id}`;
      if (target.id === definition.id || seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: key,
        from: definition.id,
        to: target.id,
        callLine: call.line,
        evidence: "call reference",
      });
    }
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  });
  const nodes: FlowNode[] = definitions.map(({ source: _source, ...definition }) => ({
    ...definition,
    incoming: incoming.get(definition.id) ?? 0,
    outgoing: outgoing.get(definition.id) ?? 0,
  }));

  const rankedRoots = [...nodes].sort((a, b) => {
    const rootA = a.incoming === 0 ? 1 : 0;
    const rootB = b.incoming === 0 ? 1 : 0;
    return rootB - rootA || Number(b.exported) - Number(a.exported) || b.outgoing - a.outgoing || a.path.localeCompare(b.path);
  });
  const covered = new Set<string>();
  const flows: ControlFlow[] = [];
  for (const root of rankedRoots) {
    if (flows.length >= 16 || (covered.has(root.id) && root.incoming > 0)) continue;
    const nodeIds = reachable(root.id, edges);
    if (nodeIds.length === 1 && root.outgoing === 0 && root.incoming > 0) continue;
    nodeIds.forEach((id) => covered.add(id));
    const nodeSet = new Set(nodeIds);
    const edgeIds = edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to)).map((edge) => edge.id);
    flows.push({ id: `flow:${root.id}`, label: root.name, rootId: root.id, nodeIds, edgeIds });
  }

  return {
    nodes,
    edges,
    flows,
    unresolvedCalls,
    inspectedFiles: sourceFiles.length,
    visibleSourceFiles: guide.files.filter((file) => file.type === "blob" && codeExtensions.test(file.path)).length,
  };
}
