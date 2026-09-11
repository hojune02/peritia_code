import { Highlight, type PrismTheme } from "prism-react-renderer";
import { detectSourceLanguage } from "../lib/source-language";

const terminalTheme: PrismTheme = {
  plain: { color: "#d8e6dc", backgroundColor: "#08110d" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#789987", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#a9c5b2" } },
    { types: ["property", "tag", "constant", "symbol", "deleted"], style: { color: "#ff8f8f" } },
    { types: ["boolean", "number"], style: { color: "#e7c66b" } },
    { types: ["selector", "attr-name", "string", "char", "builtin", "inserted"], style: { color: "#9ee493" } },
    { types: ["operator", "entity", "url"], style: { color: "#74d7ec" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#c7a8ff" } },
    { types: ["function", "class-name"], style: { color: "#78e0b0" } },
    { types: ["regex", "important", "variable"], style: { color: "#ffbd78" } },
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
