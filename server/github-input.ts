import { RepoError } from "../lib/repository";

export type RepositoryCoordinates = {
  owner: string;
  name: string;
};

const ownerPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const repositoryPattern =
  /^[A-Za-z0-9._-]{1,100}$/;

const commitPattern = /^[a-f0-9]{40}$/i;

export function parsePublicRepository(
  value: unknown,
): RepositoryCoordinates {
  if (typeof value !== "string") {
    throw new RepoError(
      "Enter a public GitHub repository URL.",
      400,
    );
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new RepoError(
      "Enter a valid GitHub repository URL.",
      400,
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new RepoError(
      "Only public github.com repository URLs are supported.",
      400,
    );
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean);

  if (segments.length !== 2) {
    throw new RepoError(
      "Use a repository URL like https://github.com/owner/repository.",
      400,
    );
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");

  if (
    !ownerPattern.test(owner) ||
    !repositoryPattern.test(name)
  ) {
    throw new RepoError(
      "The GitHub owner or repository name is invalid.",
      400,
    );
  }

  return { owner, name };
}

export function validateCommit(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    !commitPattern.test(value)
  ) {
    throw new RepoError(
      "Analyze the repository again to obtain a valid snapshot.",
      400,
    );
  }

  return value.toLowerCase();
}


export function validateSourcePath(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new RepoError(
      "This file is excluded from analysis for safety",
      400,
    );
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new RepoError(
      "This file is excluded from analysis for safety",
      400,
    );
  }

  return value;
}

export function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}