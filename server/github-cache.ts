import { createHash } from "node:crypto";
import { db } from "./db";

export type RepositorySnapshot = {
  repositoryId: string;
  owner: string;
  name: string;
  commitSha: string;
  defaultBranch: string;
  tree: unknown;
  metadata: unknown;
  treeTruncated: boolean;
  createdAt: Date;
};

export type CachedSource = {
  repositoryId: string;
  commitSha: string;
  path: string;
  content: string;
  contentHash: string;
  createdAt: Date;
};

type SnapshotRow = {
  repository_id: string;
  owner: string;
  name: string;
  commit_sha: string;
  default_branch: string;
  tree_json: unknown;
  metadata_json: unknown;
  tree_truncated: boolean;
  created_at: Date;
};

type SourceRow = {
  repository_id: string;
  commit_sha: string;
  path: string;
  content: string;
  content_hash: string;
  created_at: Date;
};

function mapSnapshot(
  row: SnapshotRow,
): RepositorySnapshot {
  return {
    repositoryId: row.repository_id,
    owner: row.owner,
    name: row.name,
    commitSha: row.commit_sha,
    defaultBranch: row.default_branch,
    tree: row.tree_json,
    metadata: row.metadata_json,
    treeTruncated: row.tree_truncated,
    createdAt: row.created_at,
  };
}

function mapSource(row: SourceRow): CachedSource {
  return {
    repositoryId: row.repository_id,
    commitSha: row.commit_sha,
    path: row.path,
    content: row.content,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

export function hashSource(content: string): string {
  return createHash("sha256")
    .update(content, "utf8")
    .digest("hex");
}

export async function findSnapshot(input: {
  repositoryId: string;
  commitSha: string;
}): Promise<RepositorySnapshot | null> {
  const result = await db.query<SnapshotRow>(
    `
      UPDATE repo_snapshots
      SET last_accessed_at = NOW()
      WHERE repository_id = $1
        AND commit_sha = $2
      RETURNING
        repository_id,
        owner,
        name,
        commit_sha,
        default_branch,
        tree_json,
        metadata_json,
        tree_truncated,
        created_at
    `,
    [input.repositoryId, input.commitSha],
  );

  const row = result.rows[0];

  if (!row) {
    console.info(
      JSON.stringify({
        event: "github_snapshot_cache_miss",
      }),
    );

    return null;
  }

  console.info(
    JSON.stringify({
      event: "github_snapshot_cache_hit",
    }),
  );

  return mapSnapshot(row);
}

export async function findSnapshotByCoordinates(input: {
  owner: string;
  name: string;
  commitSha: string;
}): Promise<RepositorySnapshot | null> {
  const result = await db.query<SnapshotRow>(
    `
      UPDATE repo_snapshots
      SET last_accessed_at = NOW()
      WHERE LOWER(owner) = LOWER($1)
        AND LOWER(name) = LOWER($2)
        AND commit_sha = $3
      RETURNING
        repository_id,
        owner,
        name,
        commit_sha,
        default_branch,
        tree_json,
        metadata_json,
        tree_truncated,
        created_at
    `,
    [input.owner, input.name, input.commitSha],
  );

  return result.rows[0]
    ? mapSnapshot(result.rows[0])
    : null;
}

export async function saveSnapshot(input: {
  repositoryId: string;
  owner: string;
  name: string;
  commitSha: string;
  defaultBranch: string;
  tree: unknown;
  metadata: unknown;
  treeTruncated: boolean;
}): Promise<RepositorySnapshot> {
  const result = await db.query<SnapshotRow>(
    `
      INSERT INTO repo_snapshots (
        repository_id,
        owner,
        name,
        commit_sha,
        default_branch,
        tree_json,
        metadata_json,
        tree_truncated
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::JSONB,
        $7::JSONB,
        $8
      )
      ON CONFLICT (
        repository_id,
        commit_sha
      )
      DO UPDATE SET
        owner = EXCLUDED.owner,
        name = EXCLUDED.name,
        default_branch = EXCLUDED.default_branch,
        tree_json = EXCLUDED.tree_json,
        metadata_json = EXCLUDED.metadata_json,
        tree_truncated = EXCLUDED.tree_truncated,
        last_accessed_at = NOW()
      RETURNING
        repository_id,
        owner,
        name,
        commit_sha,
        default_branch,
        tree_json,
        metadata_json,
        tree_truncated,
        created_at
    `,
    [
      input.repositoryId,
      input.owner,
      input.name,
      input.commitSha,
      input.defaultBranch,
      JSON.stringify(input.tree),
      JSON.stringify(input.metadata),
      input.treeTruncated,
    ],
  );

  return mapSnapshot(result.rows[0]);
}

export async function findSource(input: {
  repositoryId: string;
  commitSha: string;
  path: string;
}): Promise<CachedSource | null> {
  const result = await db.query<SourceRow>(
    `
      UPDATE source_files
      SET last_accessed_at = NOW()
      WHERE repository_id = $1
        AND commit_sha = $2
        AND path = $3
      RETURNING
        repository_id,
        commit_sha,
        path,
        content,
        content_hash,
        created_at
    `,
    [
      input.repositoryId,
      input.commitSha,
      input.path,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    console.info(
      JSON.stringify({
        event: "github_source_cache_miss",
      }),
    );

    return null;
  }

  console.info(
    JSON.stringify({
      event: "github_source_cache_hit",
    }),
  );

  return mapSource(row);
}

export async function saveSource(input: {
  repositoryId: string;
  commitSha: string;
  path: string;
  content: string;
}): Promise<CachedSource> {
  const contentHash = hashSource(input.content);

  const result = await db.query<SourceRow>(
    `
      INSERT INTO source_files (
        repository_id,
        commit_sha,
        path,
        content,
        content_hash
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (
        repository_id,
        commit_sha,
        path
      )
      DO UPDATE SET
        last_accessed_at = NOW()
      RETURNING
        repository_id,
        commit_sha,
        path,
        content,
        content_hash,
        created_at
    `,
    [
      input.repositoryId,
      input.commitSha,
      input.path,
      input.content,
      contentHash,
    ],
  );

  return mapSource(result.rows[0]);
}