import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Braces, FileCode2, GitBranch, Info, Loader2, RefreshCw } from "lucide-react";
import { buildControlFlowMap, type ControlFlowMap, type FlowNode } from "../lib/control-flow";
import type { Guide } from "../lib/repository";

function FlowNodeButton({ node, root, onOpen }: { node: FlowNode; root: boolean; onOpen: (path: string) => void }) {
  return (
    <button className="flow-node" data-root={root || undefined} onClick={() => onOpen(node.path)}>
      <span className="flow-node-icon"><Braces size={17} /></span>
      <span className="flow-node-copy">
        <strong>{node.name}()</strong>
        <small>{node.path} · line {node.line}</small>
      </span>
      <span className="flow-node-uses">{node.incoming} use{node.incoming === 1 ? "" : "s"}</span>
      <ArrowRight size={15} />
    </button>
  );
}

function FlowEndpoint({ node, onOpen }: { node: FlowNode; onOpen: (path: string) => void }) {
  return (
    <button className="flow-endpoint" onClick={() => onOpen(node.path)} title={`${node.path}:${node.line}`}>
      <Braces size={15} />
      <span><strong>{node.name}()</strong><small>{node.path}:{node.line}</small></span>
    </button>
  );
}

export function ControlFlowExplorer({ guide, onOpen }: { guide: Guide; onOpen: (path: string) => void }) {
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
  const map = guide.sample ? localMap : remote?.result;
  const [flowId, setFlowId] = useState("");

  useEffect(() => {
    setFlowId("");
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
      <aside className="panel flow-list" aria-label="Observed workflows">
        <span className="mini-label">WORKFLOWS</span>
        <h2>Follow one path</h2>
        <p>Start at one observed definition and trace the calls Peritia can resolve.</p>
        <div className="flow-picker">
          {map.flows.map((candidate) => {
            const root = nodeById.get(candidate.rootId);
            return (
              <button key={candidate.id} aria-pressed={candidate.id === flow?.id} onClick={() => setFlowId(candidate.id)}>
                <GitBranch size={15} />
                <span><strong>{candidate.label}()</strong><small>{root?.path}</small></span>
                <small>{candidate.nodeIds.length}</small>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="panel flow-canvas">
        <div className="section-heading">
          <div>
            <span className="mini-label">STATIC DEFINITION + CALL INDEX</span>
            <h2>{flow?.label ?? "Workflow"}()</h2>
          </div>
          <span className="method-badge">{flowNodes.length} definitions</span>
        </div>
        <div className="flow-disclaimer">
          <Info size={17} />
          <p>
            {remote?.status === "running" ? "Indexing is still in progress. " : ""}
            This static map covers {map.inspectedFiles} indexed source files out of {map.visibleSourceFiles} supported code files.
            {map.failedFiles ? ` ${map.failedFiles} files were skipped or could not be indexed.` : ""}
            It is not a runtime trace; dynamic dispatch, aliases, dependency injection, callbacks, and generated code may be missing.
          </p>
        </div>
        <div className="flow-graph" aria-label={`${flow?.label ?? "Selected"} workflow definitions`}>
          {flowNodes[0] && <FlowNodeButton node={nodeById.get(flow?.rootId ?? "") ?? flowNodes[0]} root onOpen={onOpen} />}
          {flowEdges.length ? (
            <div className="flow-edges" aria-label="Observed call relationships">
              {flowEdges.map((edge) => {
                const caller = nodeById.get(edge.from);
                const callee = nodeById.get(edge.to);
                if (!caller || !callee) return null;
                return (
                  <div className="flow-edge" key={edge.id}>
                    <FlowEndpoint node={caller} onOpen={onOpen} />
                    <span className="flow-edge-label"><small>{edge.evidence} · line {edge.callLine}</small><ArrowRight size={17} /></span>
                    <FlowEndpoint node={callee} onOpen={onOpen} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="flow-no-edges">No calls from this definition could be linked unambiguously to another inspected definition.</p>
          )}
        </div>
        <footer className="flow-foot">
          <FileCode2 size={15} /> Click any definition to open its source and AI notebook.
          <span>{map.unresolvedCalls.toLocaleString()} call-like references could not be resolved unambiguously.</span>
        </footer>
      </section>
    </div>
  );
}
