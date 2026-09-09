import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/repository.test.ts", "tests/features.test.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outdir: ".test-build",
});
const result = spawnSync(
  process.execPath,
  ["--test", ".test-build/repository.test.js", ".test-build/features.test.js"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
