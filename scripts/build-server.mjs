import { build } from "esbuild";
await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server/index.mjs",
  sourcemap: true,
});
