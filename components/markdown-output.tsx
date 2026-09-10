import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownOutput({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <section className="ai-markdown-shell" aria-label={live ? "Live LLM response" : "LLM explanation"}>
      <header className="ai-markdown-bar">
        <span className="ai-window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>{live ? "LIVE ANALYSIS" : "ANALYSIS COMPLETE"}</span>
        <span className={live ? "ai-stream-state live" : "ai-stream-state"}>
          {live ? "STREAMING" : "SAVED"}
        </span>
      </header>
      <div className="ai-markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          }}
        >
          {text}
        </ReactMarkdown>
        {live && <span className="ai-cursor" aria-hidden="true" />}
      </div>
    </section>
  );
}
