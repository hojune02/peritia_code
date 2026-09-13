import { Highlight, type PrismTheme } from "prism-react-renderer";
import { detectSourceLanguage } from "../lib/source-language";

const terminalTheme: PrismTheme = {
  plain: { color: "var(--code-text)", backgroundColor: "var(--code-bg)" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--syntax-comment)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--syntax-punctuation)" } },
    { types: ["property", "tag", "constant", "symbol", "deleted"], style: { color: "var(--syntax-red)" } },
    { types: ["boolean", "number"], style: { color: "var(--syntax-yellow)" } },
    { types: ["selector", "attr-name", "string", "char", "builtin", "inserted"], style: { color: "var(--syntax-green)" } },
    { types: ["operator", "entity", "url"], style: { color: "var(--syntax-blue)" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "var(--syntax-purple)" } },
    { types: ["function", "class-name"], style: { color: "var(--syntax-cyan)" } },
    { types: ["regex", "important", "variable"], style: { color: "var(--syntax-orange)" } },
  ],
};

export default function SourceCodeViewer({ path, code }: { path: string; code: string }) {
  const language = detectSourceLanguage(path);
  return (
    <Highlight theme={terminalTheme} code={code} language={language.grammar}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={`${className} source-code`} style={style}>
          <code>
            {tokens.map((line, index) => (
              <span {...getLineProps({ line })} className="code-line" key={index}>
                <span className="line-number" aria-hidden="true">{index + 1}</span>
                <span className="code-line-content">
                  {line.map((token, tokenIndex) => (
                    <span {...getTokenProps({ token })} key={tokenIndex} />
                  ))}
                  {!line.length && " "}
                </span>
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
