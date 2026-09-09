import { Buffer } from "node:buffer";
import {
  buildGuide,
  isSafeSource,
  parseRepo,
  RepoError,
  type Guide,
  type RepoFile,
  type SourceFile,
} from "../lib/repository";
import { githubJson } from "./github-client";
import {
  encodeGitHubPath,
  validateCommit,
  validateSourcePath,
} from "./github-input";
import type {
  RepositorySnapshot,
  CachedSource,
} from "./github-cache";

const MAX_FILE = 65_536;
const MAX_VISIBLE_FILES = 2_500;
const MAX_MANIFESTS = 8;

/*
 * Keep the original bounded memory cache for isolated automated tests.
 * Development and production use PostgreSQL when
 * GITHUB_CACHE_MODE=postgres.
 */
const memoryCache = new Map<
  string,
  {
    expires: number;
    guide: Guide;
  }
>();

type GitHubRepository = {
  id?: number | string;
  private?: boolean;
  default_branch?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
};

type GitHubCommit = {
  sha?: unknown;
};

type GitHubTreeEntry = {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
};

type GitHubTree = {
  tree?: unknown;
  truncated?: unknown;
};

type GitHubContent = {
  type?: unknown;
  encoding?: unknown;
  content?: unknown;
  size?: unknown;
};

type PersistentCacheModule =
  typeof import("./github-cache");

function usePersistentCache(): boolean {
  return process.env.GITHUB_CACHE_MODE === "postgres";
}

async function loadPersistentCache(): Promise<
  PersistentCacheModule | null
> {
  if (!usePersistentCache()) {
    return null;
  }

  /*
   * Dynamic import is intentional. It prevents isolated tests that
   * use the SQLite in-memory Store from importing PostgreSQL merely
   * because they import createApp().
   */
  return import("./github-cache");
}

function encodedRepositoryBase(
  owner: string,
  name: string,
): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function requireRepositoryId(
  value: unknown,
): string {
  if (
    (typeof value !== "number" &&
      typeof value !== "string") ||
    String(value).length === 0
  ) {
    throw new RepoError(
      "GitHub returned an invalid repository identifier.",
      502,
    );
  }

  return String(value);
}

function requireDefaultBranch(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255
  ) {
    throw new RepoError(
      "Only public repositories with a default branch can be analyzed.",
      400,
    );
  }

  return value;
}

function requireTree(value: unknown): GitHubTree {
  if (
    typeof value !== "object" ||
    value === null ||
    !("tree" in value) ||
    !Array.isArray(value.tree)
  ) {
    throw new RepoError(
      "Could not read the repository's file tree.",
      502,
    );
  }

  return value as GitHubTree;
}

function decodeFile(
  data: GitHubContent,
  path: string,
): SourceFile {
  if (
    data.type !== "file" ||
    data.encoding !== "base64" ||
    typeof data.content !== "string"
  ) {
    throw new RepoError(
      "This item isn't a readable source file.",
      400,
    );
  }

  if (
    (typeof data.size === "number" &&
      data.size > MAX_FILE) ||
    data.content.length > MAX_FILE * 1.5
  ) {
    throw new RepoError(
      "This file is larger than the 64 KB reading limit. Open it on GitHub instead.",
      413,
    );
  }

  const bytes = Buffer.from(
    data.content.replace(/\s/g, ""),
    "base64",
  );

  if (bytes.byteLength > MAX_FILE) {
    throw new RepoError(
      "This file is larger than the 64 KB reading limit. Open it on GitHub instead.",
      413,
    );
  }

  const content = bytes.toString("utf8");

  if (content.includes("\0")) {
    throw new RepoError(
      "Binary files aren't displayed. Open this file on GitHub instead.",
      415,
    );
  }

  return {
    path,
    content,
  };
}

function sourceFromCache(
  cached: CachedSource,
): SourceFile {
  return {
    path: cached.path,
    content: cached.content,
  };
}

async function fetchSourceFromGitHub(input: {
  owner: string;
  name: string;
  commit: string;
  path: string;
}): Promise<SourceFile> {
  const base = encodedRepositoryBase(
    input.owner,
    input.name,
  );

  const result = await githubJson<GitHubContent>(
    `${base}/contents/${encodeGitHubPath(input.path)}`,
    {
      query: {
        ref: input.commit,
      },
    },
  );

  return decodeFile(result, input.path);
}

async function readSnapshotSource(input: {
  snapshot: RepositorySnapshot;
  owner: string;
  name: string;
  commit: string;
  path: string;
  cache: PersistentCacheModule;
}): Promise<SourceFile> {
  const hit = await input.cache.findSource({
    repositoryId: input.snapshot.repositoryId,
    commitSha: input.commit,
    path: input.path,
  });

  if (hit) {
    return sourceFromCache(hit);
  }

  const source = await fetchSourceFromGitHub({
    owner: input.owner,
    name: input.name,
    commit: input.commit,
    path: input.path,
  });

  const saved = await input.cache.saveSource({
    repositoryId: input.snapshot.repositoryId,
    commitSha: input.commit,
    path: input.path,
    content: source.content,
  });

  return sourceFromCache(saved);
}

export async function readSource(
  repo: unknown,
  commitValue: unknown,
  pathValue: unknown,
): Promise<SourceFile> {
  const { owner, name } = parseRepo(repo);
  const commit = validateCommit(commitValue);
  const path = validateSourcePath(pathValue);

  if (
    !isSafeSource(path) ||
    path.startsWith("/") ||
    path.includes("\\")
  ) {
    throw new RepoError(
      "This file is excluded from analysis for safety.",
      400,
    );
  }

  const cache = await loadPersistentCache();

  /*
   * Tests and explicitly configured memory-mode environments still
   * call GitHub directly, matching the old behavior.
   */
  if (!cache) {
    return fetchSourceFromGitHub({
      owner,
      name,
      commit,
      path,
    });
  }

  const snapshot =
    await cache.findSnapshotByCoordinates({
      owner,
      name,
      commitSha: commit,
    });

  if (!snapshot) {
    throw new RepoError(
      "Import this repository again before opening its source files.",
      409,
    );
  }

  return readSnapshotSource({
    snapshot,
    owner,
    name,
    commit,
    path,
    cache,
  });
}

function selectRepositoryFiles(
  tree: GitHubTree,
): RepoFile[] {
  const entries = tree.tree as GitHubTreeEntry[];

  return entries
    .filter(
      (entry) =>
        typeof entry.path === "string" &&
        entry.type === "blob" &&
        typeof entry.sha === "string" &&
        isSafeSource(entry.path),
    )
    .map((entry) => ({
      path: entry.path as string,
      type: "blob" as const,
      size:
        typeof entry.size === "number"
          ? entry.size
          : undefined,
      sha: entry.sha as string,
    }));
}

function selectInitialSources(
  files: RepoFile[],
): {
  selected: RepoFile[];
  manifestCount: number;
} {
  const readmes = files
    .filter((file) =>
      /^readme(\.[^/]*)?$/i.test(file.path),
    )
    .sort((left, right) =>
      left.path.localeCompare(right.path),
    );

  const manifestPattern =
    /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|pipfile|setup\.py|cargo\.toml|go\.mod|pom\.xml|build\.gradle|dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i;

  const manifests = files
    .filter((file) =>
      manifestPattern.test(file.path),
    )
    .sort((left, right) => {
      const depthDifference =
        left.path.split("/").length -
        right.path.split("/").length;

      return (
        depthDifference ||
        left.path.localeCompare(right.path)
      );
    });

  /*
   * Import only one root README and at most eight manifests.
   * Entry points and all other files are loaded when selected.
   */
  const candidates = [
    ...readmes.slice(0, 1),
    ...manifests.slice(0, MAX_MANIFESTS),
  ];

  const selected = [
    ...new Map(
      candidates.map((file) => [
        file.path,
        file,
      ]),
    ).values(),
  ].filter(
    (file) =>
      (file.size ?? 0) <= MAX_FILE,
  );

  return {
    selected,
    manifestCount: manifests.length,
  };
}

async function readInitialSources(input: {
  selected: RepoFile[];
  owner: string;
  name: string;
  commit: string;
  snapshot: RepositorySnapshot | null;
  cache: PersistentCacheModule | null;
}): Promise<{
  sources: SourceFile[];
  failures: number;
}> {
  const sources: SourceFile[] = [];
  let failures = 0;

  /*
   * Four concurrent requests is conservative enough for the MVP and
   * avoids sending a large burst to GitHub.
   */
  for (
    let index = 0;
    index < input.selected.length;
    index += 4
  ) {
    const batch = await Promise.all(
      input.selected
        .slice(index, index + 4)
        .map(async (file) => {
          try {
            if (input.cache && input.snapshot) {
              return await readSnapshotSource({
                snapshot: input.snapshot,
                owner: input.owner,
                name: input.name,
                commit: input.commit,
                path: file.path,
                cache: input.cache,
              });
            }

            return await fetchSourceFromGitHub({
              owner: input.owner,
              name: input.name,
              commit: input.commit,
              path: file.path,
            });
          } catch {
            failures++;
            return null;
          }
        }),
    );

    sources.push(
      ...batch.filter(
        (source): source is SourceFile =>
          source !== null,
      ),
    );
  }

  return {
    sources,
    failures,
  };
}

export async function analyzeRepository(
  input: unknown,
): Promise<Guide> {
  const { owner, name } = parseRepo(input);
  const cacheKey = `${owner}/${name}`.toLowerCase();
  const persistentCache =
    await loadPersistentCache();

  if (!persistentCache) {
    const hit = memoryCache.get(cacheKey);

    if (hit && hit.expires > Date.now()) {
      console.info(
        JSON.stringify({
          event: "github_guide_memory_cache_hit",
        }),
      );

      return hit.guide;
    }
  }

  const base = encodedRepositoryBase(owner, name);

  const metadata =
    await githubJson<GitHubRepository>(base);

  if (metadata.private === true) {
    throw new RepoError(
      "Only public repositories can be analyzed.",
      400,
    );
  }

  const defaultBranch = requireDefaultBranch(
    metadata.default_branch,
  );
/*
 * PostgreSQL cache keys require GitHub's stable repository ID.
 * Isolated memory-mode tests can use owner/name when their
 * mocked metadata predates this requirement.
 */
const repositoryId = persistentCache
  ? requireRepositoryId(metadata.id)
  : metadata.id !== undefined
    ? String(metadata.id)
    : cacheKey;
  const commitInfo =
    await githubJson<GitHubCommit>(
      `${base}/commits/${encodeURIComponent(defaultBranch)}`,
    );

  const commit = validateCommit(commitInfo.sha);

  let snapshot: RepositorySnapshot | null = null;
  let tree: GitHubTree;

  if (persistentCache) {
    snapshot = await persistentCache.findSnapshot({
      repositoryId,
      commitSha: commit,
    });
  }

  if (snapshot) {
    tree = requireTree(snapshot.tree);
  } else {
    tree = requireTree(
      await githubJson<GitHubTree>(
        `${base}/git/trees/${commit}`,
        {
          query: {
            recursive: 1,
          },
        },
      ),
    );

    if (persistentCache) {
      snapshot =
        await persistentCache.saveSnapshot({
          repositoryId,
          owner,
          name,
          commitSha: commit,
          defaultBranch,
          tree,
          metadata,
          treeTruncated:
            tree.truncated === true,
        });
    }
  }

  const allowed = selectRepositoryFiles(tree);
  const warnings: string[] = [];

  if (
    tree.truncated === true ||
    allowed.length > MAX_VISIBLE_FILES
  ) {
    warnings.push(
      "Partial repository: GitHub's tree limit or Peritia's 2,500-file limit was reached. Counts describe only the visible snapshot.",
    );
  }

  const files = allowed.slice(
    0,
    MAX_VISIBLE_FILES,
  );

  const {
    selected,
    manifestCount,
  } = selectInitialSources(files);

  if (manifestCount > MAX_MANIFESTS) {
    warnings.push(
      "This repository contains more than eight manifests. Technology detection covers the first eight, prioritizing root-level files.",
    );
  }

  const {
    sources,
    failures,
  } = await readInitialSources({
    selected,
    owner,
    name,
    commit,
    snapshot,
    cache: persistentCache,
  });

  if (failures > 0) {
    warnings.push(
      `${failures} selected file${
        failures === 1 ? "" : "s"
      } could not be read. Some dependency details may be missing; file names remain available.`,
    );
  }

  const guide = buildGuide({
    owner,
    name,
    description:
      typeof metadata.description === "string"
        ? metadata.description
        : "The repository author hasn't provided a description. Read its README and entry points to establish the project's purpose.",
    branch: defaultBranch,
    commit,
    url: `https://github.com/${owner}/${name}`,
    stars:
      typeof metadata.stargazers_count === "number"
        ? metadata.stargazers_count
        : 0,
    files,
    sources,
    warnings,
    analyzedAt: new Date().toISOString(),
  });

  if (!persistentCache) {
    if (memoryCache.size >= 12) {
      const oldest =
        memoryCache.keys().next().value;

      if (oldest) {
        memoryCache.delete(oldest);
      }
    }

    memoryCache.set(cacheKey, {
      expires: Date.now() + 300_000,
      guide,
    });
  }

  return guide;
}