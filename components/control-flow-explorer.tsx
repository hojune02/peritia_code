import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Braces, FileCode2, GitBranch, Info } from "lucide-react";
import { buildControlFlowMap, type FlowNode } from "../lib/control-flow";
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
  const map = useMemo(() => buildControlFlowMap(guide), [guide]);
  const [flowId, setFlowId] = useState(map.flows[0]?.id ?? "");
  useEffect(() => setFlowId(map.flows[0]?.id ?? ""), [guide.commit, map.flows]);
  const flow = map.flows.find((candidate) => candidate.id === flowId) ?? map.flows[0];
  const nodeById = useMemo(() => new Map(map.nodes.map((node) => [node.id, node])), [map.nodes]);
  const flowNodes = flow?.nodeIds.map((id) => nodeById.get(id)).filter((node): node is FlowNode => Boolean(node)) ?? [];
  const flowEdges = map.edges.filter((edge) => flow?.edgeIds.includes(edge.id));

  if (!map.nodes.length) {
    return (
      <section className="panel flow-empty">
        <GitBranch size={28} />
        <h2>No function definitions were found in the inspected sources</h2>
        <p>Open files from File explorer for direct source analysis. Markup, configuration, and unsupported syntax may not form a function graph.</p>
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
            <span className="mini-label">OBSERVED DEFINITION + CALL REFERENCES</span>
            <h2>{flow?.label ?? "Workflow"}()</h2>
          </div>
          <span className="method-badge">{flowNodes.length} definitions</span>
        </div>
        <div className="flow-disclaimer">
          <Info size={17} />
          <p>
            This is a static, partial map of {map.inspectedFiles} inspected source files out of {map.visibleSourceFiles} visible code files.
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
                    <span className="flow-edge-label"><small>calls · line {edge.callLine}</small><ArrowRight size={17} /></span>
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
