import { context } from "esbuild";
import { spawn } from "node:child_process";

let backend;
let frontend;
let stopping = false;
let ctx;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  frontend?.kill("SIGTERM");
  backend?.kill("SIGTERM");
  await ctx?.dispose();
  process.exit(code);
}
ctx = await context({
  entryPoints: ["server/index.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: ".dev/server.mjs",
  plugins: [
    {
      name: "restart-express",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length || stopping) return;
          if (backend && backend.exitCode === null) {
            await new Promise((resolve) => {
              backend.once("exit", resolve);
              backend.kill("SIGTERM");
            });
          }
          if (!stopping)
            backend = spawn(process.execPath, [".dev/server.mjs"], {
              stdio: "inherit",
              env: { ...process.env, PORT: "3001", NODE_ENV: "development" },
            });
        });
      },
    },
  ],
});
await ctx.watch();
frontend = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
frontend.on("exit", (code) => {
  if (!stopping) void stop(code ?? 1);
});
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
