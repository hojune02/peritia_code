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

const API = "https://api.github.com";
const MAX_BODY = 4_000_000;
const MAX_FILE = 65_536;
const cache = new Map<string, { expires: number; guide: Guide }>();

async function github(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Peritia-Repository-Explorer",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RepoError(
      "GitHub could not be reached in time. Please try again shortly.",
      502,
    );
  }
  if (!response.ok) {
    if (response.status === 404)
      throw new RepoError(
        "Repository or file not found. Check the spelling and make sure the repository is public.",
        404,
      );
    if (response.status === 403 || response.status === 429)
      throw new RepoError(
        "GitHub is temporarily limiting requests. Please try again after the rate limit resets, or explore the built-in example meanwhile.",
        429,
      );
    if (response.status === 409)
      throw new RepoError(
        "This repository has no commits yet. Try a repository with source files.",
      );
    throw new RepoError(
      "GitHub couldn't return this repository. Please try again later.",
      502,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new RepoError("GitHub returned an empty response.", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new RepoError(
        "This repository listing is too large for the MVP. Try a smaller repository.",
        413,
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RepoError(
      "GitHub returned an unreadable response. Please retry.",
      502,
    );
  }
}

function decodeFile(data: any, path: string): SourceFile {
  if (
    data.type !== "file" ||
    data.encoding !== "base64" ||
    typeof data.content !== "string"
  )
    throw new RepoError("This item isn't a readable source file.");
  if (data.size > MAX_FILE || data.content.length > MAX_FILE * 1.5)
    throw new RepoError(
      "This file is larger than the 64 KB reading limit. Open it on GitHub instead.",
      413,
    );
  const content = Buffer.from(data.content, "base64").toString("utf8");
  if (content.includes("\0"))
    throw new RepoError(
      "Binary files aren't displayed. Open this file on GitHub instead.",
    );
  return { path, content };
}

export async function readSource(
  repo: unknown,
  commit: unknown,
  path: unknown,
) {
  const { owner, name } = parseRepo(repo);
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit))
    throw new RepoError(
      "Analyze the repository again to obtain a valid snapshot.",
    );
  if (
    typeof path !== "string" ||
    !path ||
    !isSafeSource(path) ||
    path.startsWith("/") ||
    path.includes("\\")
  )
    throw new RepoError("This file is excluded from analysis for safety.");
  const result = await github(
    `/repos/${owner}/${name}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`,
  );
  return decodeFile(result, path);
}

export async function analyzeRepository(input: unknown): Promise<Guide> {
  const { owner, name } = parseRepo(input);
  const key = `${owner}/${name}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.guide;
  const base = `/repos/${owner}/${name}`;
  const meta = await github(base);
  if (meta.private || typeof meta.default_branch !== "string")
    throw new RepoError(
      "Only public repositories with a default branch can be analyzed.",
    );
  const commitInfo = await github(
    `${base}/commits/${encodeURIComponent(meta.default_branch)}`,
  );
  if (
    typeof commitInfo.sha !== "string" ||
    !/^[a-f0-9]{40}$/.test(commitInfo.sha)
  )
    throw new RepoError("Could not resolve this repository's snapshot.", 502);
  const commit = commitInfo.sha;
  const tree = await github(`${base}/git/trees/${commit}?recursive=1`);
  if (!Array.isArray(tree.tree))
    throw new RepoError("Could not read the repository's file tree.", 502);
  const allowed: RepoFile[] = tree.tree
    .filter(
      (f: any) =>
        typeof f.path === "string" &&
        f.type === "blob" &&
        typeof f.sha === "string" &&
        isSafeSource(f.path),
    )
    .map((f: any) => ({
      path: f.path,
      type: "blob",
      size: f.size,
      sha: f.sha,
    }));
  const warnings: string[] = [];
  if (tree.truncated || allowed.length > 2500)
    warnings.push(
      "Partial repository: GitHub's tree limit or Peritia's 2,500-file limit was reached. Counts describe only the visible snapshot.",
    );
  const files = allowed.slice(0, 2500);
  const manifests = files
    .filter((f) =>
      /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/.test(
        f.path,
      ),
    )
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  const readmes = files.filter((f) => /^readme(\.[^/]*)?$/i.test(f.path));
  const entries = files
    .filter((f) =>
      /(^|\/)(main|index|App|app|server|page)\.(tsx?|jsx?|py)$/.test(f.path),
    )
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  const selected = [
    ...new Map(
      [...readmes, ...manifests.slice(0, 8), ...entries.slice(0, 7)].map(
        (f) => [f.path, f],
      ),
    ).values(),
  ]
    .filter((f) => (f.size ?? 0) <= MAX_FILE)
    .slice(0, 16);
  if (manifests.length > 8)
    warnings.push(
      "This repository contains more than eight manifests. Technology detection covers the first eight, prioritizing root-level files.",
    );
  const sources: SourceFile[] = [];
  let failed = 0;
  for (let i = 0; i < selected.length; i += 4) {
    const batch = await Promise.all(
      selected.slice(i, i + 4).map(async (f) => {
        try {
          return await readSource(
            `https://github.com/${owner}/${name}`,
            commit,
            f.path,
          );
        } catch {
          failed++;
          return null;
        }
      }),
    );
    sources.push(...batch.filter((s): s is SourceFile => !!s));
  }
  if (failed)
    warnings.push(
      `${failed} selected file${failed === 1 ? "" : "s"} could not be read. Some dependency details may be missing; file names remain available.`,
    );
  const guide = buildGuide({
    owner,
    name,
    description:
      typeof meta.description === "string"
        ? meta.description
        : "The repository author hasn't provided a description. Read its README and entry points to establish the project's purpose.",
    branch: meta.default_branch,
    commit,
    url: `https://github.com/${owner}/${name}`,
    stars: meta.stargazers_count ?? 0,
    files,
    sources,
    warnings,
    analyzedAt: new Date().toISOString(),
  });
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 300000, guide });
  return guide;
}
