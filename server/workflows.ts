import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  buildControlFlowMapFromIndexes,
  isWorkflowSourcePath,
  workflowLanguage,
  type ControlFlowMap,
  type WorkflowFileIndex,
} from "../lib/control-flow";
import { indexWorkflowSourceWithAst } from "./typescript-workflow";
import { isSafeSource, parseRepo, RepoError, type RepoFile } from "../lib/repository";
import { validateCommit } from "./github-input";
import { readSourceForIndexing } from "./github";

export type WorkflowIndexStatus = "queued" | "running" | "completed" | "failed";
export type WorkflowIndexSnapshot = {
  id: string;
  status: WorkflowIndexStatus;
  filesTotal: number;
  filesProcessed: number;
  result: ControlFlowMap | null;
  errorCode: string | null;
};

type WorkflowRow = {
  id: string;
  status: WorkflowIndexStatus;
  files_total: number;
  files_processed: number;
  result_json: ControlFlowMap | null;
  error_code: string | null;
};

type TreeEntry = {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
};

const MAX_WORKFLOW_SOURCE_BYTES = 65_536;
const WORKFLOW_FETCH_CONCURRENCY = 4;

export function workflowAnalyzerVersion() {
  const configured = process.env.WORKFLOW_ANALYZER_VERSION?.trim();
  return configured && /^[A-Za-z0-9._-]{1,80}$/.test(configured)
    ? configured
    : "workflow-v3-typescript-ast";
}

function publicIndex(row: WorkflowRow): WorkflowIndexSnapshot {
  return {
    id: row.id,
    status: row.status,
    filesTotal: Number(row.files_total || 0),
    filesProcessed: Number(row.files_processed || 0),
    result: row.result_json,
    errorCode: row.error_code,
  };
}

function workflowFiles(tree: unknown) {
  const entries = typeof tree === "object" && tree !== null && "tree" in tree
    && Array.isArray((tree as { tree?: unknown }).tree)
    ? (tree as { tree: TreeEntry[] }).tree
    : [];
  const supported = entries.filter((entry) =>
    entry.type === "blob"
    && typeof entry.path === "string"
    && typeof entry.sha === "string"
    && /^[0-9a-f]{40}$/i.test(entry.sha)
    && isSafeSource(entry.path)
    && isWorkflowSourcePath(entry.path),
  );
  const eligible = supported.filter((entry) =>
    typeof entry.size !== "number" || entry.size <= MAX_WORKFLOW_SOURCE_BYTES,
  ).map((entry) => ({
    path: entry.path as string,
    type: "blob" as const,
    sha: String(entry.sha).toLowerCase(),
    size: typeof entry.size === "number" ? entry.size : undefined,
  }));
  return { supportedCount: supported.length, eligible };
}

export class WorkflowIndexService {
  constructor(private pool: Pool) {}

  async request(input: { repo?: unknown; commit?: unknown }) {
    const { owner, name } = parseRepo(input.repo);
    const commit = validateCommit(input.commit);
    const version = workflowAnalyzerVersion();
    const snapshot = await this.pool.query<{ repository_id: string }>(
      `SELECT repository_id FROM repo_snapshots
       WHERE LOWER(owner)=LOWER($1) AND LOWER(name)=LOWER($2) AND commit_sha=$3`,
      [owner, name, commit],
    );
    const repositoryId = snapshot.rows[0]?.repository_id;
    if (!repositoryId)
      throw new RepoError("Import this repository before indexing its workflows.", 409);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const inserted = await client.query<WorkflowRow>(
        `INSERT INTO workflow_indexes
           (id,repository_id,commit_sha,analyzer_version,status)
         VALUES($1,$2,$3,$4,'queued')
         ON CONFLICT(repository_id,commit_sha,analyzer_version) DO NOTHING
         RETURNING *`,
        [id, repositoryId, commit, version],
      );
      let row = inserted.rows[0];
      if (row) {
        await client.query(
          `INSERT INTO workflow_job_outbox(workflow_index_id) VALUES($1)`,
          [row.id],
        );
      } else {
        const found = await client.query<WorkflowRow>(
          `SELECT * FROM workflow_indexes
           WHERE repository_id=$1 AND commit_sha=$2 AND analyzer_version=$3
           FOR UPDATE`,
          [repositoryId, commit, version],
        );
        row = found.rows[0];
        if (!row) throw new RepoError("Workflow index could not be created.", 500);
        if (row.status === "failed") {
          const retried = await client.query<WorkflowRow>(
            `UPDATE workflow_indexes SET status='queued',error_code=NULL,
               files_processed=0,result_json=NULL,finished_at=NULL
             WHERE id=$1 RETURNING *`,
            [row.id],
          );
          row = retried.rows[0];
          await client.query(
            `INSERT INTO workflow_job_outbox(workflow_index_id) VALUES($1)`,
            [row.id],
          );
        }
      }
      await client.query("COMMIT");
      return publicIndex(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new RepoError("Workflow index ID is invalid.");
    const result = await this.pool.query<WorkflowRow>(
      `SELECT * FROM workflow_indexes WHERE id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new RepoError("Workflow index not found.", 404);
    return publicIndex(result.rows[0]);
  }
}

async function fileIndex(
  pool: Pool,
  input: { file: RepoFile; repositoryId: string; repo: string; commit: string; version: string },
): Promise<WorkflowFileIndex> {
  const language = workflowLanguage(input.file.path);
  const cached = await pool.query<{ result_json: { definitions?: WorkflowFileIndex["definitions"] } }>(
    `UPDATE workflow_file_indexes SET last_accessed_at=NOW()
     WHERE blob_sha=$1 AND language=$2 AND analyzer_version=$3
     RETURNING result_json`,
    [input.file.sha, language, input.version],
  );
  if (cached.rows[0]) {
    return {
      path: input.file.path,
      definitions: Array.isArray(cached.rows[0].result_json?.definitions)
        ? cached.rows[0].result_json.definitions
        : [],
    };
  }

  const opened = await pool.query<{ content: string }>(
    `SELECT content FROM source_files
     WHERE repository_id=$1 AND commit_sha=$2 AND path=$3`,
    [input.repositoryId, input.commit, input.file.path],
  );
  const source = opened.rows[0]
    ? { path: input.file.path, content: opened.rows[0].content }
    : await readSourceForIndexing(input.repo, input.commit, input.file.path);
  const indexed = await indexWorkflowSourceWithAst(source);
  await pool.query(
    `INSERT INTO workflow_file_indexes
       (blob_sha,language,analyzer_version,result_json)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(blob_sha,language,analyzer_version)
     DO UPDATE SET last_accessed_at=NOW()`,
    [input.file.sha, language, input.version, { definitions: indexed.definitions }],
  );
  return indexed;
}

export async function processWorkflowIndex(pool: Pool, id: string) {
  const claimed = await pool.query<{
    id: string;
    repository_id: string;
    commit_sha: string;
    analyzer_version: string;
    owner: string;
    name: string;
    tree_json: unknown;
  }>(
    `UPDATE workflow_indexes w SET status='running',started_at=COALESCE(started_at,NOW()),
       heartbeat_at=NOW(),error_code=NULL
     FROM repo_snapshots s
     WHERE w.id=$1 AND s.repository_id=w.repository_id AND s.commit_sha=w.commit_sha
       AND (w.status='queued' OR (w.status='running' AND w.heartbeat_at < NOW() - INTERVAL '2 minutes'))
     RETURNING w.id,w.repository_id,w.commit_sha,w.analyzer_version,s.owner,s.name,s.tree_json`,
    [id],
  );
  const row = claimed.rows[0];
  if (!row) return;

  try {
    const { supportedCount, eligible } = workflowFiles(row.tree_json);
    await pool.query(
      `UPDATE workflow_indexes SET files_total=$2,files_processed=0,heartbeat_at=NOW()
       WHERE id=$1`,
      [id, eligible.length],
    );
    const indexed: WorkflowFileIndex[] = [];
    let failures = supportedCount - eligible.length;
    let lastPreview = 0;
    for (let offset = 0; offset < eligible.length; offset += WORKFLOW_FETCH_CONCURRENCY) {
      const batch = await Promise.all(eligible.slice(offset, offset + WORKFLOW_FETCH_CONCURRENCY).map(async (file) => {
        try {
          return await fileIndex(pool, {
            file,
            repositoryId: row.repository_id,
            repo: `${row.owner}/${row.name}`,
            commit: row.commit_sha,
            version: row.analyzer_version,
          });
        } catch (error) {
          // Provider-wide failures should retry the durable job. Treating a
          // rate limit or outage as hundreds of independent missing files
          // would incorrectly publish an empty "completed" index.
          if (error instanceof RepoError && (error.status === 429 || error.status >= 500))
            throw error;
          failures++;
          console.warn(JSON.stringify({
            event: "workflow_file_index_failed",
            workflowIndexId: id,
            path: file.path,
            error: error instanceof Error ? error.message : "UNKNOWN",
          }));
          return null;
        }
      }));
      indexed.push(...batch.filter((item): item is WorkflowFileIndex => item !== null));
      const processed = Math.min(offset + batch.length, eligible.length);
      const previewDue = Date.now() - lastPreview > 1_500 || processed === eligible.length;
      const preview = previewDue
        ? buildControlFlowMapFromIndexes(indexed, supportedCount, failures)
        : null;
      if (previewDue) lastPreview = Date.now();
      await pool.query(
        `UPDATE workflow_indexes SET files_processed=$2,heartbeat_at=NOW(),
           result_json=COALESCE($3,result_json)
         WHERE id=$1 AND status='running'`,
        [id, processed, preview],
      );
    }
    const result = buildControlFlowMapFromIndexes(indexed, supportedCount, failures);
    await pool.query(
      `UPDATE workflow_indexes SET status='completed',files_processed=files_total,
         result_json=$2,error_code=$3,heartbeat_at=NOW(),finished_at=NOW()
       WHERE id=$1 AND status='running'`,
      [id, result, failures ? `PARTIAL_${failures}_FILES` : null],
    );
  } catch (error) {
    await pool.query(
      `UPDATE workflow_indexes SET status='queued',error_code=$2,heartbeat_at=NOW()
       WHERE id=$1 AND status='running'`,
      [id, error instanceof Error ? error.message.slice(0, 180) : "WORKFLOW_INDEX_FAILED"],
    );
    throw error;
  }
}

export async function failWorkflowIndex(pool: Pool, id: string, code: string) {
  await pool.query(
    `UPDATE workflow_indexes SET status='failed',error_code=$2,finished_at=NOW()
     WHERE id=$1 AND status <> 'completed'`,
    [id, code.slice(0, 180)],
  );
}
