// Signed-in dashboard probe for status.experientiallabs.ai.
//
// The public checker proves the sign-in page and the API answer; it cannot see
// a failure that only hits SIGNED-IN pages. On 2026-09-22 22:55-23:20Z every
// signed-in page of platform.experientiallabs.ai intermittently 502'd (an nginx
// TLS sidecar in the web pods rejected Next.js responses whose Set-Cookie carried
// the chunked Supabase session cookies) while /signin, the 401 API check, and
// the authenticated /v1/models call all stayed green.
//
// This script does what a browser does, with a dedicated monitor account:
//
//   1. Sign in with the GoTrue password grant (STATUS_SUPABASE_URL +
//      STATUS_SUPABASE_ANON_KEY), exactly the token endpoint the platform's
//      own sign-in route calls.
//   2. Encode the session the way @supabase/ssr 0.10 does (cookie name
//      sb-<project-ref>-auth-token, value "base64-" + base64url(JSON), split
//      into <name>.0, <name>.1, ... chunks of 3180 characters) and request the
//      signed-in landing page (/overview) through the PUBLIC hostname, so the
//      request crosses the same edge, ingress, TLS sidecar, and Next.js proxy
//      as a user's. The page must answer 200 and carry the render marker.
//   3. Repeat with the same tokens but expires_at in the past. The platform's
//      proxy then refreshes the session and WRITES the chunked Set-Cookie
//      headers on the response, the exact response shape the sidecar rejected.
//      (The monitor account carries padded user metadata so its session always
//      exceeds one chunk, like a real OAuth session does.)
//
// A 5xx, a redirect (to /signin or anywhere), the error boundary text, a
// missing marker, or a timeout fails the attempt. A failed attempt is retried
// once after RETRY_DELAY_MS with a fresh sign-in: two failures are DOWN, a
// failure followed by a pass is DEGRADED (that intermittent pattern IS the
// incident above), and a slow pass (over SLOW_MS) is DEGRADED too. A sign-in
// the auth service refuses with a 4xx is a monitor misconfiguration (rotated
// password, revoked key) and reports "unknown" instead of a false outage; a
// 5xx or unreachable auth service is DOWN, because users cannot sign in either.
//
// Zero dependencies (Node 20+). `node scripts/signed-in-probe.mjs --out FILE`
// writes the JSON the status UI renders; the verdict also lands in
// $GITHUB_OUTPUT when set. Every run signs the monitor out at the end.

import { writeFileSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TARGET_URL = "https://platform.experientiallabs.ai/overview";
export const MAX_CHUNK_SIZE = 3180;
export const REQUEST_TIMEOUT_MS = 20_000;
export const SLOW_MS = 10_000;
export const RETRY_DELAY_MS = 10_000;
export const USER_AGENT = "experientiallabs-status-signed-in-probe/1.0 (+https://status.experientiallabs.ai)";
// The overview's own client component; present in the server-rendered HTML.
export const RENDER_MARKER = 'data-testid="usage-summary"';
// The app's root error boundary (apps/web/app/error.tsx).
export const ERROR_BOUNDARY_TEXT = "Couldn't reach the Experiential backend";

const NOTES =
  "Synthetic signed-in check: a dedicated monitor account signs in with the password grant, presents the " +
  "session exactly as the browser cookies do (@supabase/ssr chunked base64url cookies), and loads the " +
  "signed-in landing page through the public hostname; then repeats with an expired access token so the " +
  "proxy refreshes the session and writes the chunked Set-Cookie response (the 2026-09-22 failure shape). " +
  "Refreshed every 5 minutes by the signed-in-health workflow. down = the page did not render on two " +
  "attempts (5xx, redirect, error boundary, timeout) or sign-in itself failed server-side; degraded = " +
  "one attempt failed or the render was slow; unknown = the monitor could not sign in for a client-side " +
  "reason (misconfiguration), which never alerts.";

/** sb-<project-ref>-auth-token, the default storage key supabase-js derives from the project URL. */
export function cookieNameFor(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** "base64-" + base64url(JSON), @supabase/ssr's default cookieEncoding. */
export function encodeSession(session) {
  return "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

/**
 * @supabase/ssr's createChunks for this alphabet: base64url never needs
 * percent-encoding, so encodeURIComponent(value).length === value.length and
 * the chunks are plain 3180-character slices, named <key>.0, <key>.1, ...
 * A value that fits in one chunk is stored unsuffixed.
 */
export function chunkCookie(name, value, chunkSize = MAX_CHUNK_SIZE) {
  if (!/^[A-Za-z0-9_-]*$/.test(value.replace(/^base64-/, ""))) {
    throw new Error("cookie value is not base64url; chunking would need percent-encoding");
  }
  if (value.length <= chunkSize) return [{ name, value }];
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += chunkSize, n += 1) {
    chunks.push({ name: `${name}.${n}`, value: value.slice(i, i + chunkSize) });
  }
  return chunks;
}

export function sessionCookieHeader(supabaseUrl, session) {
  return chunkCookie(cookieNameFor(supabaseUrl), encodeSession(session))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

/** The Set-Cookie chunks of the auth cookie written on a response (removals with Max-Age=0 excluded). */
export function authSetCookies(setCookies, name) {
  return (setCookies || []).filter((header) => {
    const [pair, ...attrs] = header.split(";");
    const cookieName = pair.split("=")[0].trim();
    const isAuth = cookieName === name || cookieName.startsWith(`${name}.`);
    return isAuth && !attrs.some((attr) => /^\s*max-age=0\s*$/i.test(attr));
  });
}

/**
 * One page fetch judged the way a user would: only a 200 that carries the
 * render marker and not the error boundary counts. Redirects are not followed;
 * a 3xx (the proxy's bounce to /signin) is a failure like a 5xx.
 */
export function assessPage({ status, location, body, elapsedMs }) {
  if (status !== 200) {
    const where = status >= 300 && status < 400 && location ? ` to ${location}` : "";
    return { ok: false, reason: `HTTP ${status}${where}` };
  }
  if (body.includes(ERROR_BOUNDARY_TEXT)) return { ok: false, reason: "rendered the error boundary" };
  if (!body.includes(RENDER_MARKER)) return { ok: false, reason: "200 without the render marker" };
  return { ok: true, reason: "", slow: elapsedMs > SLOW_MS };
}

/**
 * The verdict for a run: attempts is the list of per-attempt results
 * ({ ok, reason, slow, ... }); signIn is { ok, status, clientError, reason }.
 */
export function verdictFor({ signIn, attempts }) {
  if (!signIn.ok) {
    return signIn.clientError
      ? { verdict: "unknown", reason: `Monitor could not sign in: ${signIn.reason}` }
      : { verdict: "down", reason: `Sign-in failed at the auth service: ${signIn.reason}` };
  }
  const last = attempts[attempts.length - 1];
  const failures = attempts.filter((attempt) => !attempt.ok);
  if (!last.ok) {
    return {
      verdict: "down",
      reason: `The signed-in dashboard did not render on ${attempts.length} attempt(s): ${last.reason}.`,
    };
  }
  if (failures.length > 0) {
    return {
      verdict: "degraded",
      reason: `The signed-in dashboard failed once (${failures[0].reason}) and rendered on retry: intermittent errors.`,
    };
  }
  if (last.slow) {
    return { verdict: "degraded", reason: `The signed-in dashboard rendered but slowly (${last.slowest} ms).` };
  }
  return { verdict: "ok", reason: "" };
}

async function timedFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { response, body, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function signIn(env) {
  const started = Date.now();
  try {
    const { response, body, elapsedMs } = await timedFetch(`${env.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.anonKey, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ email: env.email, password: env.password }),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error_code || parsed.msg || parsed.error || "";
      } catch {
        // not JSON
      }
      return {
        ok: false,
        status: response.status,
        clientError: response.status >= 400 && response.status < 500,
        reason: `HTTP ${response.status}${detail ? ` ${detail}` : ""}`,
        elapsedMs,
      };
    }
    const session = JSON.parse(body);
    if (!session.access_token || !session.refresh_token) {
      return { ok: false, status: response.status, clientError: true, reason: "token response without tokens", elapsedMs };
    }
    return { ok: true, status: response.status, session, elapsedMs };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      clientError: false,
      reason: error && error.name === "AbortError" ? "timed out" : `unreachable (${error && error.message})`,
      elapsedMs: Date.now() - started,
    };
  }
}

async function loadPage(cookie) {
  try {
    const { response, body, elapsedMs } = await timedFetch(TARGET_URL, {
      headers: { cookie, "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "manual",
    });
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    return {
      status: response.status,
      location: response.headers.get("location"),
      body,
      bytes: body.length,
      elapsedMs,
      setCookies,
      ...assessPage({ status: response.status, location: response.headers.get("location"), body, elapsedMs }),
    };
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return {
      status: 0,
      location: null,
      body: "",
      bytes: 0,
      elapsedMs: REQUEST_TIMEOUT_MS,
      setCookies: [],
      ok: false,
      reason: timedOut ? `timed out after ${REQUEST_TIMEOUT_MS} ms` : `fetch failed (${error && error.message})`,
    };
  }
}

async function signOut(env, accessToken) {
  if (!accessToken) return;
  try {
    await fetch(`${env.url}/auth/v1/logout?scope=global`, {
      method: "POST",
      headers: { apikey: env.anonKey, Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Best effort: an un-revoked session expires on its own.
  }
}

/** One attempt: sign in, fresh render, refresh render, sign out. */
async function attempt(env) {
  const auth = await signIn(env);
  if (!auth.ok) return { signIn: auth, ok: false, reason: auth.reason };
  const { session } = auth;
  const cookieName = cookieNameFor(env.url);
  let latestAccessToken = session.access_token;
  try {
    const fresh = await loadPage(sessionCookieHeader(env.url, session));
    const expired = { ...session, expires_at: Math.floor(Date.now() / 1000) - 120, expires_in: 0 };
    const refresh = await loadPage(sessionCookieHeader(env.url, expired));
    const chunks = authSetCookies(refresh.setCookies, cookieName);
    // The refreshed access token revokes cleanly; the old refresh token is spent.
    const joined = chunks
      .map((header) => header.split(";")[0])
      .sort()
      .map((pair) => pair.slice(pair.indexOf("=") + 1))
      .join("");
    if (joined.startsWith("base64-")) {
      try {
        latestAccessToken = JSON.parse(Buffer.from(joined.slice(7), "base64url").toString("utf8")).access_token || latestAccessToken;
      } catch {
        // Unparseable chunks: keep the original token for sign-out.
      }
    }
    const ok = fresh.ok && refresh.ok;
    const reason = !fresh.ok ? `fresh session: ${fresh.reason}` : !refresh.ok ? `refreshed session: ${refresh.reason}` : "";
    const refreshWroteCookies = chunks.length > 0;
    return {
      signIn: auth,
      ok,
      reason,
      slow: fresh.slow || refresh.slow || false,
      slowest: Math.max(fresh.elapsedMs, refresh.elapsedMs),
      refreshWroteCookies,
      figures: {
        signInMs: auth.elapsedMs,
        pageStatus: fresh.status,
        pageMs: fresh.elapsedMs,
        pageBytes: fresh.bytes,
        refreshStatus: refresh.status,
        refreshMs: refresh.elapsedMs,
        refreshSetCookieChunks: chunks.length,
        markerFound: fresh.ok && refresh.ok,
      },
    };
  } finally {
    await signOut(env, latestAccessToken);
  }
}

export function readEnv(source = process.env) {
  const env = {
    url: source.STATUS_SUPABASE_URL,
    anonKey: source.STATUS_SUPABASE_ANON_KEY,
    email: source.STATUS_MONITOR_EMAIL,
    password: source.STATUS_MONITOR_PASSWORD,
  };
  const missing = Object.entries({
    STATUS_SUPABASE_URL: env.url,
    STATUS_SUPABASE_ANON_KEY: env.anonKey,
    STATUS_MONITOR_EMAIL: env.email,
    STATUS_MONITOR_PASSWORD: env.password,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);
  return env;
}

export async function runProbe(env, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const attempts = [];
  let signInResult = { ok: true };
  let lastReason = "";
  for (let i = 0; i < 2; i += 1) {
    if (i > 0) {
      log(`attempt ${i} failed (${lastReason}); retrying in ${RETRY_DELAY_MS} ms`);
      await sleep(RETRY_DELAY_MS);
    }
    const result = await attempt(env);
    lastReason = result.reason;
    if (!result.signIn.ok) {
      signInResult = result.signIn;
      // A client-side refusal will not change on retry; a server failure gets one.
      if (result.signIn.clientError || i > 0) break;
      continue;
    }
    signInResult = { ok: true };
    attempts.push(result);
    log(
      `attempt ${i + 1}: ${result.ok ? "ok" : `FAIL ${result.reason}`} ` +
        `(fresh ${result.figures.pageStatus} in ${result.figures.pageMs} ms, ` +
        `refresh ${result.figures.refreshStatus} in ${result.figures.refreshMs} ms, ` +
        `${result.figures.refreshSetCookieChunks} Set-Cookie chunk(s))`
    );
    if (result.ok) break;
  }
  const { verdict, reason } = verdictFor({ signIn: signInResult, attempts });
  const last = attempts[attempts.length - 1];
  let finalReason = reason;
  if (verdict === "ok" && last && !last.refreshWroteCookies) {
    // Rendered fine but the refresh path wrote no session: the check lost half
    // its coverage. Surface it as degraded so someone looks, without an outage claim.
    return {
      verdict: "degraded",
      reason: "The page rendered but the session refresh wrote no Set-Cookie; the refresh path is unverified.",
      attempts: attempts.length,
      figures: last.figures,
    };
  }
  return {
    verdict,
    reason: finalReason,
    attempts: attempts.length,
    figures: last ? last.figures : { signInMs: signInResult.elapsedMs ?? null, signInStatus: signInResult.status ?? null },
  };
}

export function buildRecord(result, now = new Date()) {
  return {
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    target: TARGET_URL,
    notes: NOTES,
    verdict: result.verdict,
    reason: result.reason,
    attempts: result.attempts,
    figures: result.figures,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
  const env = readEnv();
  const previous = outPath && existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  const result = await runProbe(env, { log: (line) => console.log(line) });
  const record = buildRecord(result);
  console.log(`verdict: ${record.verdict}${record.reason ? ` (${record.reason})` : ""}`);
  console.log(JSON.stringify(record.figures));
  if (outPath) writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `verdict=${record.verdict}\nreason=${record.reason.replace(/\r?\n/g, " ")}\nprevious=${previous.verdict || "ok"}\n`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
