import test from "node:test";
import assert from "node:assert/strict";
import {
  assessPage,
  authSetCookies,
  chunkCookie,
  cookieNameFor,
  encodeSession,
  ERROR_BOUNDARY_TEXT,
  MAX_CHUNK_SIZE,
  readEnv,
  RENDER_MARKER,
  sessionCookieHeader,
  SLOW_MS,
  verdictFor,
} from "../scripts/signed-in-probe.mjs";

test("cookie name is supabase-js's default storage key for the project URL", () => {
  assert.equal(cookieNameFor("https://dreqyhnthzwwlvtvdtix.supabase.co"), "sb-dreqyhnthzwwlvtvdtix-auth-token");
  assert.equal(cookieNameFor("http://127.0.0.1:54321"), "sb-127-auth-token");
});

test("session encodes as @supabase/ssr does: base64- prefix, base64url JSON, no padding", () => {
  const session = { access_token: "a.b.c", refresh_token: "r", expires_at: 1, user: { id: "u", email: "x@y.z" } };
  const encoded = encodeSession(session);
  assert.ok(encoded.startsWith("base64-"));
  assert.match(encoded.slice(7), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8")), session);
});

test("a value within one chunk keeps the bare name; larger values split into .0 .1 ... at 3180", () => {
  const short = "base64-" + "A".repeat(100);
  assert.deepEqual(chunkCookie("k", short), [{ name: "k", value: short }]);
  const long = "base64-" + "B".repeat(MAX_CHUNK_SIZE * 2 + 50 - 7);
  const chunks = chunkCookie("k", long);
  assert.deepEqual(chunks.map((c) => c.name), ["k.0", "k.1", "k.2"]);
  assert.equal(chunks[0].value.length, MAX_CHUNK_SIZE);
  assert.equal(chunks[1].value.length, MAX_CHUNK_SIZE);
  assert.equal(chunks[2].value.length, 50);
  assert.equal(chunks.map((c) => c.value).join(""), long);
  assert.throws(() => chunkCookie("k", "base64-not/base64url+"), /base64url/);
});

test("cookie header joins chunks with '; ' in order", () => {
  const session = { access_token: "x".repeat(4000), refresh_token: "r" };
  const header = sessionCookieHeader("https://ref.supabase.co", session);
  const names = header.split("; ").map((pair) => pair.split("=")[0]);
  assert.deepEqual(names, ["sb-ref-auth-token.0", "sb-ref-auth-token.1"]);
});

test("authSetCookies keeps the auth cookie's written chunks and drops removals", () => {
  const name = "sb-ref-auth-token";
  const headers = [
    `${name}=; Path=/; Max-Age=0`,
    `${name}.0=base64-abc; Path=/; Max-Age=34560000; SameSite=lax`,
    `${name}.1=def; Path=/; Max-Age=34560000`,
    "explabs-active-org=1; Path=/",
  ];
  assert.deepEqual(authSetCookies(headers, name), [headers[1], headers[2]]);
  assert.deepEqual(authSetCookies([], name), []);
});

test("assessPage: only a 200 with the marker and without the error boundary passes", () => {
  const good = `<html>${RENDER_MARKER}</html>`;
  assert.deepEqual(assessPage({ status: 200, location: null, body: good, elapsedMs: 500 }), { ok: true, reason: "", slow: false });
  assert.equal(assessPage({ status: 200, location: null, body: good, elapsedMs: SLOW_MS + 1 }).slow, true);
  assert.deepEqual(assessPage({ status: 307, location: "https://p/signin?next=%2Foverview", body: "", elapsedMs: 1 }), {
    ok: false,
    reason: "HTTP 307 to https://p/signin?next=%2Foverview",
  });
  assert.equal(assessPage({ status: 502, location: null, body: "bad gateway", elapsedMs: 1 }).reason, "HTTP 502");
  assert.equal(
    assessPage({ status: 200, location: null, body: `${RENDER_MARKER} ${ERROR_BOUNDARY_TEXT}`, elapsedMs: 1 }).reason,
    "rendered the error boundary"
  );
  assert.equal(assessPage({ status: 200, location: null, body: "<html>signin form</html>", elapsedMs: 1 }).reason, "200 without the render marker");
});

test("verdict: two failures are down, a failure then a pass is degraded, slow is degraded, clean pass is ok", () => {
  const pass = { ok: true, reason: "", slow: false, slowest: 800 };
  const fail = { ok: false, reason: "fresh session: HTTP 502", slow: false, slowest: 100 };
  const signedIn = { ok: true };
  assert.equal(verdictFor({ signIn: signedIn, attempts: [pass] }).verdict, "ok");
  assert.equal(verdictFor({ signIn: signedIn, attempts: [fail, fail] }).verdict, "down");
  assert.match(verdictFor({ signIn: signedIn, attempts: [fail, fail] }).reason, /2 attempt\(s\): fresh session: HTTP 502/);
  assert.equal(verdictFor({ signIn: signedIn, attempts: [fail, pass] }).verdict, "degraded");
  assert.match(verdictFor({ signIn: signedIn, attempts: [fail, pass] }).reason, /intermittent/);
  assert.equal(verdictFor({ signIn: signedIn, attempts: [{ ...pass, slow: true, slowest: 12000 }] }).verdict, "degraded");
});

test("verdict: sign-in refused client-side is unknown (never an outage); auth service failure is down", () => {
  assert.equal(verdictFor({ signIn: { ok: false, clientError: true, reason: "HTTP 400 invalid_credentials" }, attempts: [] }).verdict, "unknown");
  assert.equal(verdictFor({ signIn: { ok: false, clientError: false, reason: "HTTP 503" }, attempts: [] }).verdict, "down");
  assert.equal(verdictFor({ signIn: { ok: false, clientError: false, reason: "timed out" }, attempts: [] }).verdict, "down");
});

test("readEnv names every missing variable", () => {
  assert.throws(() => readEnv({ STATUS_SUPABASE_URL: "https://x.supabase.co" }), /STATUS_SUPABASE_ANON_KEY, STATUS_MONITOR_EMAIL, STATUS_MONITOR_PASSWORD/);
  assert.deepEqual(
    readEnv({ STATUS_SUPABASE_URL: "u", STATUS_SUPABASE_ANON_KEY: "a", STATUS_MONITOR_EMAIL: "e", STATUS_MONITOR_PASSWORD: "p" }),
    { url: "u", anonKey: "a", email: "e", password: "p" }
  );
});
