import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Braces,
  ChevronRight,
  CornerDownRight,
  FileCode2,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { buildControlFlowMap, type ControlFlowMap, type FlowEdge, type FlowNode } from "../lib/control-flow";
import type { Guide } from "../lib/repository";

type OpenDefinition = (path: string, line: number) => void;

function StartNode({ node, onOpen }: { node: FlowNode; onOpen: OpenDefinition }) {
  return (
    <button
      className="flow-start-node"
      onClick={() => onOpen(node.path, node.line)}
      title={`Open ${node.name} at ${node.path}:${node.line}`}
    >
      <span className="flow-step-number">1</span>
      <span className="flow-start-copy">
        <small>START HERE</small>
        <strong>{node.name}()</strong>
        <span>{node.path} · definition at line {node.line}</span>
      </span>
      <span className="flow-open-definition">Open definition <ArrowRight size={15} /></span>
    </button>
  );
}

function CallTarget({ edge, node, onOpen }: { edge: FlowEdge; node: FlowNode; onOpen: OpenDefinition }) {
  const evidence = edge.evidence === "same-file call" ? "Same file" : "Likely cross-file match";
  return (
    <button
      className="flow-call-target"
      onClick={() => onOpen(node.path, node.line)}
      title={`Open ${node.name} at ${node.path}:${node.line}`}
    >
      <span className="flow-call-origin">Line {edge.callLine}</span>
      <CornerDownRight size={17} />
      <span className="flow-target-copy">
        <strong>{node.name}()</strong>
        <small>{node.path} · definition at line {node.line}</small>
      </span>
      <span className="flow-evidence">{evidence}</span>
      <ChevronRight size={16} />
    </button>
  );
}

export function ControlFlowExplorer({ guide, onOpen }: { guide: Guide; onOpen: OpenDefinition }) {
  const localMap = useMemo(() => buildControlFlowMap(guide), [guide]);
  const [remote, setRemote] = useState<{
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    filesTotal: number;
    filesProcessed: number;
    result: ControlFlowMap | null;
    errorCode: string | null;
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [flowQuery, setFlowQuery] = useState("");
  const map = guide.sample ? localMap : remote?.result;
  const [flowId, setFlowId] = useState("");

  useEffect(() => {
    setFlowId("");
    setFlowQuery("");
    setRemote(null);
    setLoadError("");
    if (guide.sample) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const accept = async (response: Response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Workflow indexing is unavailable.");
      if (!stopped) setRemote(body);
      if (body.status === "failed")
        throw new Error("Workflow indexing failed. Retry to queue a fresh attempt.");
      return body as NonNullable<typeof remote>;
    };
    const poll = async (id: string) => {
      if (stopped) return;
      try {
        const snapshot = await accept(await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        }));
        if (snapshot.status === "queued" || snapshot.status === "running")
          timer = setTimeout(() => void poll(id), 1_250);
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError"))
          setLoadError(error instanceof Error ? error.message : "Workflow indexing is unavailable.");
      }
    };
    void fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: guide.url, commit: guide.commit }),
      signal: controller.signal,
    }).then(accept).then((snapshot) => {
      if (snapshot.status === "queued" || snapshot.status === "running") void poll(snapshot.id);
    }).catch((error) => {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError"))
        setLoadError(error instanceof Error ? error.message : "Workflow indexing is unavailable.");
    });
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [guide.commit, guide.sample, guide.url, retry]);

  const flow = map?.flows.find((candidate) => candidate.id === flowId) ?? map?.flows[0];
  const nodeById = useMemo(() => new Map((map?.nodes ?? []).map((node) => [node.id, node])), [map]);
  const flowNodes = flow?.nodeIds.map((id) => nodeById.get(id)).filter((node): node is FlowNode => Boolean(node)) ?? [];
  const flowEdges = (map?.edges ?? []).filter((edge) => flow?.edgeIds.includes(edge.id));
  const root = nodeById.get(flow?.rootId ?? "") ?? flowNodes[0];
  const visibleFlows = (map?.flows ?? []).filter((candidate) => {
    const candidateRoot = nodeById.get(candidate.rootId);
    const search = flowQuery.trim().toLowerCase();
    return !search || candidate.label.toLowerCase().includes(search) || candidateRoot?.path.toLowerCase().includes(search);
  });

  const callsBySource = new Map<string, FlowEdge[]>();
  flowEdges.forEach((edge) => callsBySource.set(edge.from, [...(callsBySource.get(edge.from) ?? []), edge]));
  const callGroups: Array<{ caller: FlowNode; calls: Array<{ edge: FlowEdge; target: FlowNode }> }> = [];
  const visited = new Set<string>();
  const queue = root ? [root.id] : [];
  while (queue.length) {
    const callerId = queue.shift()!;
    if (visited.has(callerId)) continue;
    visited.add(callerId);
    const caller = nodeById.get(callerId);
    const calls = (callsBySource.get(callerId) ?? [])
      .map((edge) => ({ edge, target: nodeById.get(edge.to) }))
      .filter((call): call is { edge: FlowEdge; target: FlowNode } => Boolean(call.target))
      .sort((left, right) => left.edge.callLine - right.edge.callLine);
    if (caller && calls.length) callGroups.push({ caller, calls });
    calls.forEach(({ target }) => {
      if (!visited.has(target.id)) queue.push(target.id);
    });
  }

  if (!guide.sample && (loadError || !map || remote?.status === "queued")) {
    const percent = remote?.filesTotal
      ? Math.round((remote.filesProcessed / remote.filesTotal) * 100)
      : 0;
    return (
      <section className="panel flow-indexing" aria-live="polite">
        {loadError ? <RefreshCw size={28} /> : <Loader2 size={28} className="spin" />}
        <h2>{loadError ? "Workflow indexing paused" : "Building the workflow overview"}</h2>
        <p>{loadError || "Peritia is inspecting supported source files in the background. You can use every other part of the guide while this continues."}</p>
        {!loadError && (
          <>
            <div className="flow-progress"><span style={{ width: `${percent}%` }} /></div>
            <small>{remote?.filesTotal ? `${remote.filesProcessed.toLocaleString()} of ${remote.filesTotal.toLocaleString()} files indexed` : "Waiting for the workflow worker…"}</small>
          </>
        )}
        {loadError && <button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry indexing</button>}
      </section>
    );
  }

  if (!map?.nodes.length) {
    return (
      <section className="panel flow-empty">
        <GitBranch size={28} />
        <h2>No function definitions were found in the inspected sources</h2>
        <p>The complete supported-file index contains no recognized definitions. Markup, configuration, generated files, or unsupported syntax may not form a function graph.</p>
      </section>
    );
  }

  return (
    <div className="flow-layout">
      <aside className="panel flow-list" aria-label="Workflow starting points">
        <span className="mini-label">STARTING FUNCTIONS</span>
        <h2>Choose where to begin</h2>
        <p>Select one function to reveal the calls Peritia can connect from it.</p>
        <label className="flow-search">
          <Search size={15} />
          <input
            value={flowQuery}
            onChange={(event) => setFlowQuery(event.target.value)}
            placeholder="Find a function or file"
            aria-label="Find a workflow starting function"
          />
        </label>
        <div className="flow-picker">
          {visibleFlows.map((candidate) => {
            const candidateRoot = nodeById.get(candidate.rootId);
            const calls = candidate.edgeIds.length;
            return (
              <button key={candidate.id} aria-pressed={candidate.id === flow?.id} onClick={() => setFlowId(candidate.id)}>
                <Braces size={15} />
                <span><strong>{candidate.label}()</strong><small>{candidateRoot?.path}</small></span>
                <span className="flow-picker-count">{calls} call{calls === 1 ? "" : "s"}</span>
              </button>
            );
          })}
          {!visibleFlows.length && <p className="flow-no-results">No functions match “{flowQuery}”.</p>}
        </div>
      </aside>

      <section className="panel flow-canvas">
        <header className="flow-canvas-heading">
          <div>
            <span className="mini-label">SELECTED STARTING FUNCTION</span>
            <h2>{root?.name ?? "Workflow"}()</h2>
            {root && <p>{root.path} · line {root.line}</p>}
          </div>
          <div className="flow-metrics" aria-label="Selected workflow size">
            <span><strong>{flowNodes.length}</strong> functions reached</span>
            <span><strong>{flowEdges.length}</strong> resolved calls</span>
          </div>
        </header>

        <ol className="flow-howto" aria-label="How to use this workflow">
          <li><span>1</span><div><strong>Start</strong><small>Open the entry function</small></div></li>
          <li><span>2</span><div><strong>Follow</strong><small>Read its calls in line order</small></div></li>
          <li><span>3</span><div><strong>Inspect</strong><small>Jump to any definition</small></div></li>
        </ol>

        <div className="flow-graph" aria-label={`${root?.name ?? "Selected"} workflow calls`}>
          {root && <StartNode node={root} onOpen={onOpen} />}
          {callGroups.length ? (
            <div className="flow-call-groups">
              {callGroups.map(({ caller, calls }, groupIndex) => (
                <article className="flow-call-group" key={caller.id}>
                  <header>
                    <span className="flow-group-number">{groupIndex + 2}</span>
                    <span className="flow-group-copy">
                      <small>CALLS FROM</small>
                      <strong>{caller.name}()</strong>
                      <span>{caller.path} · line {caller.line}</span>
                    </span>
                    <button onClick={() => onOpen(caller.path, caller.line)}>
                      Open caller <ArrowRight size={14} />
                    </button>
                  </header>
                  <div className="flow-call-list">
                    {calls.map(({ edge, target }) => (
                      <CallTarget key={edge.id} edge={edge} node={target} onOpen={onOpen} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flow-no-edges">
              <GitBranch size={20} />
              <strong>No linked calls from this function</strong>
              <p>Choose another starting function or open this definition to inspect it directly.</p>
            </div>
          )}
        </div>

        <footer className="flow-foot">
          <span><FileCode2 size={15} /> Function cards open the exact definition line.</span>
          <span>{map.unresolvedCalls.toLocaleString()} call-like references could not be linked unambiguously.</span>
        </footer>
        <details className="flow-limitations">
          <summary><Info size={15} /> How this map is built</summary>
          <p>
            {remote?.status === "running" ? "Indexing is still in progress. " : ""}
            This static map covers {map.inspectedFiles} indexed source files out of {map.visibleSourceFiles} supported code files.{" "}
            {map.failedFiles ? `${map.failedFiles} files were skipped or could not be indexed. ` : ""}
            It is not a runtime trace; dynamic dispatch, aliases, dependency injection, callbacks, and generated code may be missing.
          </p>
        </details>
      </section>
    </div>
  );
}
