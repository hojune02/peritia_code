import { build } from "esbuild";
await build({
  entryPoints: {
    api: "server/index.ts",
    worker: "server/worker.ts",
  },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist/server",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
});
