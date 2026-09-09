import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["tests/postgres-integration.test.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outfile: ".test-build/postgres-integration.test.js",
});
const result = spawnSync(process.execPath, ["--test", ".test-build/postgres-integration.test.js"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
