import { importPKCS8, SignJWT } from "jose";

let cached: { token: string; expiresAt: number } | null = null;

export async function githubCredential(env = process.env, request: typeof fetch = fetch) {
  const appId = env.GITHUB_APP_ID;
  const installationId = env.GITHUB_INSTALLATION_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !installationId || !privateKey) return env.GITHUB_TOKEN?.trim() || null;
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKey, "RS256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
  const response = await request(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Peritia",
      },
    },
  );
  const body: any = await response.json();
  if (!response.ok || typeof body.token !== "string") throw new Error("GITHUB_APP_TOKEN_FAILED");
  cached = { token: body.token, expiresAt: new Date(body.expires_at).valueOf() };
  return cached.token;
}

export function clearGitHubCredentialCache() { cached = null; }
