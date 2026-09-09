import type { Pool } from "pg";
import type { Guide, SavedRepository } from "../lib/repository";
import { isSafeSource, parseRepo, RepoError } from "../lib/repository";
import { restoreRepositoryGuide } from "./github";
import { validateCommit, validateSourcePath } from "./github-input";
import type { RepositorySnapshot } from "./github-cache";

type SavedRow = {
  repository_id: string;
  owner: string;
  name: string;
  commit_sha: string;
  default_branch: string;
  tree_json: unknown;
  metadata_json: unknown;
  tree_truncated: boolean;
  created_at: Date;
  imported_at: Date;
  last_opened_at: Date;
  reviewed_count?: number;
};

type SummaryRow = {
  repository_id: string;
  owner: string;
  name: string;
  commit_sha: string;
  default_branch: string;
  description: string | null;
  stars: number;
  file_count: number;
  imported_at: Date;
  last_opened_at: Date;
  reviewed_count: number;
};

function summary(row: SummaryRow): SavedRepository {
  return {
    repositoryId: row.repository_id,
    owner: row.owner,
    name: row.name,
    commit: row.commit_sha,
    branch: row.default_branch,
    description: row.description || "",
    stars: Number(row.stars || 0),
    fileCount: Number(row.file_count),
    reviewedCount: Number(row.reviewed_count || 0),
    importedAt: new Date(row.imported_at).toISOString(),
    lastOpenedAt: new Date(row.last_opened_at).toISOString(),
  };
}

function snapshot(row: SavedRow): RepositorySnapshot {
  return {
    repositoryId: row.repository_id,
    owner: row.owner,
    name: row.name,
    commitSha: row.commit_sha,
    defaultBranch: row.default_branch,
    tree: row.tree_json,
    metadata: row.metadata_json,
    treeTruncated: row.tree_truncated,
    createdAt: new Date(row.created_at),
  };
}

function repositoryId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(value))
    throw new RepoError("Repository identifier is invalid.");
  return value;
}

export class RepositoryLibrary {
  constructor(private pool: Pool) {}

  async save(userId: string, guide: Guide) {
    const result = await this.pool.query(
      `INSERT INTO user_repositories (user_id, repository_id, commit_sha, file_count)
       SELECT $1, repository_id, commit_sha, $5
       FROM repo_snapshots
       WHERE LOWER(owner)=LOWER($2) AND LOWER(name)=LOWER($3) AND commit_sha=$4
       ON CONFLICT (user_id, repository_id) DO UPDATE SET
         commit_sha=EXCLUDED.commit_sha,
         file_count=EXCLUDED.file_count,
         last_opened_at=NOW()
       RETURNING repository_id`,
      [userId, guide.owner, guide.name, guide.commit, guide.files.length],
    );
    if (!result.rows[0]) throw new RepoError("The repository snapshot could not be saved.", 500);
    await this.pool.query(
      `DELETE FROM user_reviewed_files
       WHERE user_id=$1 AND repository_id=$2 AND commit_sha<>$3`,
      [userId, result.rows[0].repository_id, guide.commit],
    );
  }

  async list(userId: string): Promise<SavedRepository[]> {
    const result = await this.pool.query<SummaryRow>(
      `SELECT s.repository_id, s.owner, s.name, s.commit_sha, s.default_branch,
         CASE WHEN jsonb_typeof(s.metadata_json->'description')='string'
           THEN s.metadata_json->>'description' ELSE NULL END AS description,
         CASE WHEN jsonb_typeof(s.metadata_json->'stargazers_count')='number'
           THEN (s.metadata_json->>'stargazers_count')::int ELSE 0 END AS stars,
         u.file_count, u.imported_at, u.last_opened_at,
         (SELECT COUNT(*)::int FROM user_reviewed_files r
          WHERE r.user_id=u.user_id AND r.repository_id=u.repository_id
            AND r.commit_sha=u.commit_sha) AS reviewed_count
       FROM user_repositories u
       JOIN repo_snapshots s
         ON s.repository_id=u.repository_id AND s.commit_sha=u.commit_sha
       WHERE u.user_id=$1
       ORDER BY u.last_opened_at DESC
       LIMIT 100`,
      [userId],
    );
    return result.rows.map(summary);
  }

  async open(userId: string, rawRepositoryId: unknown) {
    const id = repositoryId(rawRepositoryId);
    const result = await this.pool.query<SavedRow>(
      `WITH opened AS (
         UPDATE user_repositories
         SET last_opened_at=NOW()
         WHERE user_id=$1 AND repository_id=$2
         RETURNING *
       )
       SELECT s.*, opened.imported_at, opened.last_opened_at
       FROM opened
       JOIN repo_snapshots s
         ON s.repository_id=opened.repository_id AND s.commit_sha=opened.commit_sha`,
      [userId, id],
    );
    const row = result.rows[0];
    if (!row) throw new RepoError("Saved repository not found.", 404);
    const [guide, reviewed] = await Promise.all([
      restoreRepositoryGuide(snapshot(row)),
      this.pool.query<{ path: string }>(
        `SELECT path FROM user_reviewed_files
         WHERE user_id=$1 AND repository_id=$2 AND commit_sha=$3
         ORDER BY reviewed_at`,
        [userId, row.repository_id, row.commit_sha],
      ),
    ]);
    return { guide, reviewedPaths: reviewed.rows.map((item) => item.path) };
  }

  async remove(userId: string, rawRepositoryId: unknown) {
    const id = repositoryId(rawRepositoryId);
    const result = await this.pool.query<{ repository_id: string }>(
      `DELETE FROM user_repositories
       WHERE user_id=$1 AND repository_id=$2
       RETURNING repository_id`,
      [userId, id],
    );
    if (!result.rows[0]) throw new RepoError("Saved repository not found.", 404);
    return { ok: true };
  }

  async setReviewed(userId: string, input: { repo?: unknown; commit?: unknown; path?: unknown; reviewed?: unknown }) {
    const { owner, name } = parseRepo(input.repo);
    const commit = validateCommit(input.commit);
    const path = validateSourcePath(input.path);
    if (!isSafeSource(path)) throw new RepoError("This file is excluded from saved progress.");
    if (typeof input.reviewed !== "boolean") throw new RepoError("Reviewed state must be true or false.");
    const linked = await this.pool.query<{ repository_id: string }>(
      `SELECT u.repository_id
       FROM user_repositories u
       JOIN repo_snapshots s
         ON s.repository_id=u.repository_id AND s.commit_sha=u.commit_sha
       WHERE u.user_id=$1 AND LOWER(s.owner)=LOWER($2) AND LOWER(s.name)=LOWER($3)
         AND s.commit_sha=$4`,
      [userId, owner, name, commit],
    );
    const id = linked.rows[0]?.repository_id;
    if (!id) throw new RepoError("Import this repository before saving file progress.", 404);
    if (input.reviewed) {
      await this.pool.query(
        `INSERT INTO user_reviewed_files (user_id,repository_id,commit_sha,path)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id,repository_id,commit_sha,path)
         DO UPDATE SET reviewed_at=NOW()`,
        [userId, id, commit, path],
      );
    } else {
      await this.pool.query(
        `DELETE FROM user_reviewed_files
         WHERE user_id=$1 AND repository_id=$2 AND commit_sha=$3 AND path=$4`,
        [userId, id, commit, path],
      );
    }
    return { ok: true };
  }
}
