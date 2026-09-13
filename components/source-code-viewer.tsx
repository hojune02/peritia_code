import { useEffect, useRef } from "react";
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

export default function SourceCodeViewer({ path, code, focusLine }: { path: string; code: string; focusLine?: number | null }) {
  const language = detectSourceLanguage(path);
  const focusedLineRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!focusLine) return;
    const frame = requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      focusedLineRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [code, focusLine, path]);

  return (
    <Highlight theme={terminalTheme} code={code} language={language.grammar}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={`${className} source-code`} style={style}>
          <code>
            {tokens.map((line, index) => {
              const lineNumber = index + 1;
              return (
                <span
                  {...getLineProps({ line })}
                  className="code-line"
                  data-focused={lineNumber === focusLine || undefined}
                  ref={lineNumber === focusLine ? focusedLineRef : undefined}
                  key={index}
                >
                  <span className="line-number" aria-hidden="true">{lineNumber}</span>
                  <span className="code-line-content">
                    {line.map((token, tokenIndex) => (
                      <span {...getTokenProps({ token })} key={tokenIndex} />
                    ))}
                    {!line.length && " "}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
