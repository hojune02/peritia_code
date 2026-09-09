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
        <>
          <UsageControl />
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
        </>
      )}
    </section>
  );
}

function UsageControl() {
  const [usage, setUsage] = useState<{ plan: string; remaining: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/usage")
      .then(async (response) => {
        if (!response.ok) throw new Error("Usage is unavailable.");
        setUsage(await response.json());
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Usage is unavailable."));
  }, []);
  const openBilling = async (path: "checkout" | "portal") => {
    setError("");
    const response = await fetch(`/api/billing/${path}`, {
      method: path === "checkout" ? "POST" : "GET",
      headers: path === "checkout" ? { "Content-Type": "application/json" } : undefined,
      body: path === "checkout" ? "{}" : undefined,
    });
    const body = await response.json();
    if (!response.ok || !body.url) {
      setError(body.error || "Billing is unavailable.");
      return;
    }
    location.assign(body.url);
  };
  return (
    <div className="ai-range">
      <span>{usage ? `${usage.plan} plan · ${usage.remaining} explanations remaining` : "Loading allowance…"}</span>
      {usage?.plan === "paid" ? (
        <button className="small-link" onClick={() => void openBilling("portal")}>Manage subscription</button>
      ) : (
        <button className="small-link" onClick={() => void openBilling("checkout")}>Upgrade</button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
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
  const { refresh, user } = useAccount();
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState<string | null>(null),
    [progress, setProgress] = useState("");
  const storageKey = `peritia:explanation:${user?.id}:${guide.commit}:${path}:${page}:${level}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    setJobId(saved);
    setData(null);
    setProgress("");
    setError("");
  }, [storageKey]);

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    setBusy(true);
    const events = new EventSource(`/api/explanations/${jobId}/events`);
    const apply = (event: MessageEvent) => {
      if (!live) return;
      const snapshot = JSON.parse(event.data);
      setProgress(snapshot.text || "");
      if (snapshot.result) setData(snapshot.result);
      if (snapshot.status === "completed") {
        setBusy(false);
        events.close();
      } else if (snapshot.status === "failed") {
        setBusy(false);
        setError("The explanation failed and its reserved credit was restored.");
        events.close();
      }
    };
    events.addEventListener("snapshot", apply as EventListener);
    events.addEventListener("complete", apply as EventListener);
    events.addEventListener("failed", apply as EventListener);
    events.onerror = () => {
      if (live && events.readyState === EventSource.CLOSED) {
        setBusy(false);
        setError("The live connection closed. Reopen this file to reconnect.");
      }
    };
    return () => { live = false; events.close(); };
  }, [jobId]);

  const generate = () => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    setProgress("");
    void (async () => {
      try {
        const response = await fetch("/api/explanations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            repositoryId: guide.sample ? "sample" : guide.url,
            commit: guide.commit,
            path,
            page,
            level,
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (response.status === 401) void refresh();
        if (!response.ok)
          throw new Error(result.error || "Explanation failed.");
        sessionStorage.setItem(storageKey, result.jobId);
        setJobId(result.jobId);
        if (result.result) setData(result.result);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Explanation failed.");
      } finally {
        if (!jobId) setBusy(false);
      }
    })();
  };
  return (
    <div aria-live="polite">
      {!jobId && !busy && (
        <button className="primary-button" onClick={generate}>
          Explain this section
        </button>
      )}
      {busy && (
        <p className="ai-loading" role="status">
          <Loader2 size={18} className="spin" />
          {progress
            ? "Generating… progress is saved if you leave this tab."
            : "Queued for the local model… You can keep browsing."}
        </p>
      )}
      {busy && progress && (
        <details className="ai-raw-response">
          <summary>Show generation progress</summary>
          <pre><code>{progress}</code></pre>
        </details>
      )}
      {error && (
        <div className="ai-error">
          <p role="alert">{error}</p>
          <p>File facts and source code below are still available.</p>
          <button
            className="secondary-button"
            onClick={() => {
              sessionStorage.removeItem(storageKey);
              setJobId(null);
              generate();
            }}
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
