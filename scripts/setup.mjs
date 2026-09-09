import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(
    ".env already exists; left unchanged. Check JWT_SECRET and APP_ORIGIN against .env.example.",
  );
} else {
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8").replace(
      "JWT_SECRET=",
      "JWT_SECRET=" + randomBytes(48).toString("hex"),
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log("Created .env with a random JWT secret. Ready for npm run dev.");
}
