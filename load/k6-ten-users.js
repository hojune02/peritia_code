import http from "k6/http";
import { check, fail, sleep } from "k6";

export const options = {
  scenarios: {
    ten_users: { executor: "per-vu-iterations", vus: 10, iterations: 1, maxDuration: "5m" },
  },
  thresholds: { checks: ["rate==1"], http_req_failed: ["rate<0.01"] },
};

const base = __ENV.BASE_URL;
const users = JSON.parse(__ENV.TEST_USERS || "[]");
const inputs = JSON.parse(__ENV.TEST_INPUTS || "[]");

export default function () {
  const user = users[__VU - 1];
  const input = inputs[__VU - 1];
  if (!base || !user || !input) fail("Provide BASE_URL plus ten TEST_USERS and TEST_INPUTS entries.");
  const headers = { "Content-Type": "application/json", Origin: base };
  const login = http.post(`${base}/api/auth/login`, JSON.stringify(user), { headers });
  check(login, { "login succeeds": (response) => response.status === 200 });
  const cookie = login.cookies.peritia_session?.[0] || login.cookies["__Host-peritia_session"]?.[0];
  if (!cookie) fail("Login did not issue a session cookie.");
  headers.Cookie = `${cookie.name}=${cookie.value}`;
  const suffix = (Date.now() + __VU).toString(16).padStart(12, "0").slice(-12);
  headers["Idempotency-Key"] = `00000000-0000-4000-8000-${suffix}`;
  const submitted = http.post(`${base}/api/explanations`, JSON.stringify(input), { headers });
  check(submitted, { "job accepted": (response) => response.status === 202 || response.status === 200 });
  const jobId = submitted.json("jobId");
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = http.get(`${base}/api/explanations/${jobId}`, { headers });
    const state = status.json("status");
    if (state === "completed") {
      const usage = http.get(`${base}/api/usage`, { headers });
      check(usage, { "one request is accounted": (response) => Number(response.json("consumed")) >= 1 });
      return;
    }
    if (state === "failed") fail(`Job ${jobId} failed.`);
    sleep(1);
  }
  fail(`Job ${jobId} did not finish.`);
}
