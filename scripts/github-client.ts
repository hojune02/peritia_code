import { RepoError } from "../lib/repository";

const githubOrigin = "https://api.github.com";
const requestTimeoutMs = 15_000;
const maxSourceBytes = 256 * 1024;

type GitHubRequestOptions = {
  accept?: string;
  query?: Record<string, string | number | boolean | undefined>;
};

export type GitHubRateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
};

export class GitHubRequestError extends RepoError {
  readonly githubStatus: number;
  readonly rateLimit: GitHubRateLimit;

  constructor(
    message: string,
    status: number,
    githubStatus: number,
    rateLimit: GitHubRateLimit,
  ) {
    super(message, status);
    this.name = "GitHubRequestError";
    this.githubStatus = githubStatus;
    this.rateLimit = rateLimit;
  }
}

function numericHeader(
  response: Response,
  name: string,
): number | null {
  const value = response.headers.get(name);

  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rateLimitFrom(response: Response): GitHubRateLimit {
  const reset = numericHeader(
    response,
    "x-ratelimit-reset",
  );

  return {
    limit: numericHeader(response, "x-ratelimit-limit"),
    remaining: numericHeader(
      response,
      "x-ratelimit-remaining",
    ),
    resetAt:
      reset === null
        ? null
        : new Date(reset * 1_000).toISOString(),
    retryAfterSeconds: numericHeader(
      response,
      "retry-after",
    ),
  };
}

function buildUrl(
  pathname: string,
  query: GitHubRequestOptions["query"] = {},
): URL {
  /*
   * "//evil.example" would change the hostname when passed to
   * new URL(). Reject protocol-relative and absolute URLs.
   */
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("\\")
  ) {
    throw new Error("GitHub client requires a relative API path");
  }

  const url = new URL(pathname, githubOrigin);

  if (url.origin !== githubOrigin) {
    throw new Error("Invalid GitHub API origin");
  }

  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }

  return url;
}

function requestHeaders(
  accept: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "Peritia",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = process.env.GITHUB_TOKEN?.trim();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function logGitHubRequest(
  response: Response,
  startedAt: number,
  requestType: "json" | "source",
): void {
  const rate = rateLimitFrom(response);

  console.info(
    JSON.stringify({
      event: "github_request",
      requestType,
      status: response.status,
      durationMs: Date.now() - startedAt,
      githubRemaining: rate.remaining,
      githubResetAt: rate.resetAt,
    }),
  );
}

async function providerErrorMessage(
  response: Response,
): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      message?: unknown;
    };

    return typeof body.message === "string"
      ? body.message
      : null;
  } catch {
    return null;
  }
}

async function assertSuccessful(
  response: Response,
): Promise<void> {
  if (response.ok) {
    return;
  }

  const rate = rateLimitFrom(response);
  const providerMessage = await providerErrorMessage(response);

  if (
    response.status === 429 ||
    (response.status === 403 &&
      (rate.remaining === 0 ||
        rate.retryAfterSeconds !== null))
  ) {
    console.warn(
      JSON.stringify({
        event: "github_rate_limited",
        status: response.status,
        githubRemaining: rate.remaining,
        githubResetAt: rate.resetAt,
        retryAfterSeconds: rate.retryAfterSeconds,
      }),
    );

    throw new GitHubRequestError(
      "GitHub is temporarily limiting requests. Please retry later.",
      429,
      response.status,
      rate,
    );
  }

  if (response.status === 404) {
    throw new GitHubRequestError(
      "The repository, commit, or source file was not found.",
      404,
      response.status,
      rate,
    );
  }

  if (response.status === 401) {
    console.error(
      JSON.stringify({
        event: "github_authentication_failed",
        status: response.status,
      }),
    );

    throw new GitHubRequestError(
      "GitHub authentication is currently unavailable.",
      502,
      response.status,
      rate,
    );
  }

  console.error(
    JSON.stringify({
      event: "github_provider_error",
      status: response.status,
      providerMessage,
    }),
  );

  throw new GitHubRequestError(
    "GitHub could not complete this request.",
    502,
    response.status,
    rate,
  );
}

export async function githubJson<T>(
  pathname: string,
  options: GitHubRequestOptions = {},
): Promise<T> {
  const url = buildUrl(pathname, options.query);
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: requestHeaders(
      options.accept ?? "application/vnd.github+json",
    ),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  logGitHubRequest(response, startedAt, "json");
  await assertSuccessful(response);

  return (await response.json()) as T;
}

export async function githubSource(
  pathname: string,
  options: GitHubRequestOptions = {},
): Promise<string> {
  const url = buildUrl(pathname, options.query);
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: requestHeaders(
      "application/vnd.github.raw+json",
    ),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  logGitHubRequest(response, startedAt, "source");
  await assertSuccessful(response);

  const contentLength = numericHeader(
    response,
    "content-length",
  );

  if (
    contentLength !== null &&
    contentLength > maxSourceBytes
  ) {
    throw new RepoError(
      "This source file is too large to display.",
      413,
    );
  }

  const bytes = new Uint8Array(
    await response.arrayBuffer(),
  );

  if (bytes.byteLength > maxSourceBytes) {
    throw new RepoError(
      "This source file is too large to display.",
      413,
    );
  }

  try {
    return new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new RepoError(
      "This file is binary or is not valid UTF-8 text.",
      415,
    );
  }
}