import { useEffect, useState } from "react";
import { Sparkles, Loader2, ExternalLink } from "lucide-react";
import { useAccount } from "./account";
import { PAGE_LINES, type Explanation } from "../lib/explanation";
import { sourceUrl, type Guide } from "../lib/repository";

export function AIExplanation({
  guide,
  path,
  content,
  level,
}: {
  guide: Guide;
  path: string;
  content: string;
  level: string;
}) {
  const account = useAccount();
  const [page, setPage] = useState(0);
  const total = content.replace(/\r\n/g, "\n").split("\n").length;
  return (
    <section className="ai-panel" aria-label="AI file explanation">
      <span className="mini-label">
        <Sparkles size={15} /> LOCAL AI · NO API FEES
      </span>
      <h3>Understand the code</h3>
      <p className="metadata-note">
        The selected section goes to the server owner's local Ollama model.
        Source excerpts are checked; the explanation can still be mistaken.
      </p>
      {total > PAGE_LINES && (
        <label className="ai-range">
          Section to explain
          <select
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {Array.from({ length: Math.ceil(total / PAGE_LINES) }, (_, i) => (
              <option key={i} value={i}>
                Lines {i * PAGE_LINES + 1}–
                {Math.min(total, (i + 1) * PAGE_LINES)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!account.ready ? (
        <p role="status">Checking your session…</p>
      ) : !account.user ? (
        <button className="primary-button" onClick={account.open}>
          Sign in for AI explanations
        </button>
      ) : (
        <Generated
          key={[
            account.user.id,
            guide.url,
            guide.commit,
            path,
            page,
            level,
          ].join(":")}
          guide={guide}
          path={path}
          page={page}
          level={level}
        />
      )}
    </section>
  );
}
function Generated({
  guide,
  path,
  page,
  level,
}: {
  guide: Guide;
  path: string;
  page: number;
  level: string;
}) {
  const { refresh } = useAccount();
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setBusy(true);
    setError("");
    setData(null);
    const timeout = setTimeout(() => controller.abort(), 135000);
    void (async () => {
      try {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: guide.sample ? "sample" : guide.url,
            commit: guide.commit,
            path,
            page,
            level,
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!live) return;
        if (response.status === 401) void refresh();
        if (!response.ok)
          throw new Error(result.error || "Explanation failed.");
        setData(result);
      } catch (e) {
        if (live)
          setError(
            e instanceof Error && e.name !== "AbortError"
              ? e.message
              : "The local model took too long. Try again after it finishes loading.",
          );
      } finally {
        clearTimeout(timeout);
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [guide.url, guide.commit, guide.sample, path, page, level, attempt]);
  return (
    <div aria-live="polite">
      {busy && (
        <p className="ai-loading" role="status">
          <Loader2 size={18} className="spin" />
          Reading this section with the local model… The first run may take up
          to two minutes.
        </p>
      )}
      {error && (
        <div className="ai-error">
          <p role="alert">{error}</p>
          <p>File facts and source code below are still available.</p>
          <button
            className="secondary-button"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry explanation
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="metadata-note">
            {data.model} · Lines {data.startLine}–{data.endLine} of{" "}
            {data.totalLines} ·{" "}
            {data.cached ? "Cached result" : "Generated now"}
          </p>
          {data.unverified && data.rawText && (
            <div className="ai-raw-response">
              <strong>Unverified local AI response</strong>

              <p>
                The model answered, but its citation metadata did not pass
                validation. Check this explanation against the Source code tab.
              </p>

              <pre>
                <code>{data.rawText}</code>
              </pre>
            </div>
          )}
          {!data.unverified &&
            data.claims.map((claim, i) => (
              <article className="ai-claim" key={i}>
                <span className={`claim-kind ${claim.kind}`}>
                  {claim.kind === "inference"
                    ? "Inference — check context"
                    : "Observation — check interpretation"}
                </span>
                <p>{claim.text}</p>
                <details>
                  <summary>
                    Inspect evidence · lines {claim.startLine}–{claim.endLine}
                  </summary>
                  <pre>
                    <code>{claim.quote}</code>
                  </pre>
                  {!guide.sample && (
                    <a
                      className="small-link"
                      href={
                        sourceUrl(guide, path) +
                        `#L${claim.startLine}-L${claim.endLine}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      View these lines on GitHub
                      <ExternalLink size={13} />
                    </a>
                  )}
                </details>
              </article>
            ))}
          <div className="ai-limits">
            <strong>What this section cannot establish</strong>
            <ul>
              <li>
                Other files and runtime behavior were not inspected by the
                model.
              </li>
              {data.limitations.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </div>
          {data.totalLines > PAGE_LINES && (
            <p className="metadata-note">
              Only this section was explained. Select another section above to
              continue.
            </p>
          )}
        </>
      )}
    </div>
  );
}
