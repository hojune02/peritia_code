import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRepo,
  isSafeSource,
  buildGuide,
  sourceUrl,
  summarizeSource,
} from "../lib/repository";
import { demoGuide } from "../lib/demo";
import { analyzeRepository, readSource } from "../server/github";

test("accepts HTTPS GitHub repositories and owner/name shorthand", () => {
  assert.deepEqual(
    parseRepo("https://github.com/hojune02/podcast-transcriptor.git"),
    { owner: "hojune02", name: "podcast-transcriptor" },
  );
  assert.deepEqual(parseRepo("expressjs/express"), {
    owner: "expressjs",
    name: "express",
  });
});
test("rejects arbitrary hosts, credentials, ports, branch URLs, and malformed inputs", () => {
  for (const value of [
    null,
    42,
    "",
    "http://github.com/a/b",
    "https://localhost/a/b",
    "https://github.com.evil.test/a/b",
    "https://secret@github.com/a/b",
    "https://github.com:444/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b?q=x",
    "https://github.com/a/b#x",
    "https://github.com/a/.",
  ])
    assert.throws(() => parseRepo(value));
});
test("excludes common secrets, generated output, dependencies, and lockfiles", () => {
  for (const path of [
    ".env",
    ".env.local",
    "src/.env.production",
    "private.pem",
    "secrets.json",
    "id_rsa",
    "node_modules/a/index.js",
    "dist/index.js",
    "a/../b",
    "package-lock.json",
  ])
    assert.equal(isSafeSource(path), false, path);
  assert.equal(isSafeSource("src/components/TaskCard.tsx"), true);
});
test("example is explicitly labeled and all tech evidence resolves to visible files", () => {
  assert.equal(demoGuide.sample, true);
  for (const tech of demoGuide.technologies)
    for (const path of tech.evidence)
      assert.ok(demoGuide.files.some((f) => f.path === path));
  assert.ok(demoGuide.technologies.some((t) => t.name === "React"));
  assert.ok(demoGuide.technologies.some((t) => t.name === "Express"));
  assert.equal(demoGuide.folders.find((f) => f.path === "server")?.count, 3);
});
test("a malicious dependency name cannot enter the technology catalog", () => {
  const guide = buildGuide({
    ...demoGuide,
    sources: [
      {
        path: "package.json",
        content:
          '{"dependencies":{"constructor":"1","__proto__":"1","react":"1"}}',
      },
    ],
  });
  assert.ok(guide.technologies.every((t) => typeof t.name === "string"));
  assert.ok(guide.technologies.some((t) => t.name === "React"));
});
test("bad package JSON is skipped without crashing", () => {
  const guide = buildGuide({
    ...demoGuide,
    sources: [{ path: "package.json", content: "not json" }],
  });
  assert.equal(guide.scripts.length, 0);
});
test("extracts local imports and symbol names", () => {
  const result = summarizeSource(
    'import React from "react";\nimport { Item } from "./Item";\nexport function App() {}',
  );
  assert.deepEqual(result.imports, ["react", "./Item"]);
  assert.ok(result.symbols.includes("App"));
});
test("source references use immutable snapshot and encoded path", () => {
  assert.equal(
    sourceUrl(
      { ...demoGuide, url: "https://github.com/a/b", commit: "a".repeat(40) },
      "src/a b.ts",
    ),
    `https://github.com/a/b/blob/${"a".repeat(40)}/src/a%20b.ts`,
  );
});
test("GitHub ingestion pins the commit and derives technology from fetched files", async () => {
  const original = globalThis.fetch;
  const sha = "b".repeat(40);
  const paths: string[] = [];
  globalThis.fetch = async (input: any) => {
    const url = new URL(String(input));
    paths.push(url.pathname + url.search);
    let body: any;
    if (url.pathname === "/repos/testing/fixture")
      body = {
        default_branch: "main",
        description: "Test app",
        stargazers_count: 4,
        private: false,
      };
    else if (url.pathname.includes("/commits/")) body = { sha };
    else if (url.pathname.includes("/git/trees/"))
      body = {
        tree: [
          { path: "package.json", type: "blob", size: 75, sha },
          { path: "src/main.ts", type: "blob", size: 25, sha },
          { path: ".env", type: "blob", size: 20, sha },
        ],
      };
    else if (url.pathname.includes("/contents/"))
      body = {
        type: "file",
        encoding: "base64",
        size: 50,
        content: Buffer.from(
          url.pathname.endsWith("package.json")
            ? '{"dependencies":{"react":"19"}}'
            : "export const value = 1;",
        ).toString("base64"),
      };
    else throw new Error("Unexpected request");
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const guide = await analyzeRepository("testing/fixture");
    assert.equal(guide.commit, sha);
    assert.equal(guide.files.length, 2);
    assert.equal(guide.sources.length, 1);
    assert.ok(guide.technologies.some((t) => t.name === "React"));
    assert.ok(
      paths
        .filter((p) => p.includes("/contents/"))
        .every((p) => p.endsWith("?ref=" + sha)),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("GitHub 404 and rate-limit errors are understandable", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    await assert.rejects(
      () => analyzeRepository("testing/missing"),
      /not found/,
    );
    globalThis.fetch = async () => new Response("{}", { status: 403 });
    await assert.rejects(
      () => analyzeRepository("testing/limited"),
      /limiting requests/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("rejects oversized and binary sources", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          size: 80000,
          content: "eA==",
        }),
      );
    await assert.rejects(
      () => readSource("a/b", "a".repeat(40), "a.ts"),
      /64 KB/,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          size: 2,
          content: "AAA=",
        }),
      );
    await assert.rejects(
      () => readSource("a/b", "a".repeat(40), "a.bin"),
      /Binary/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("source route requires commit hash and safe path before fetching", async () => {
  await assert.rejects(() => readSource("a/b", "main", "a.ts"), /snapshot/);
  await assert.rejects(
    () => readSource("a/b", "a".repeat(40), ".env.local"),
    /excluded/,
  );
  await assert.rejects(
    () => readSource("a/b", "a".repeat(40), "/etc/passwd"),
    /excluded/,
  );
});
