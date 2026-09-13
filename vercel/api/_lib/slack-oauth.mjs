// Slack OAuth v2 for the "Add to Slack" flow, incoming-webhook scope only.
// Stateless CSRF protection: `state` is "<timestamp>.<hmac>" signed with the
// client secret and mirrored in a short-lived cookie; the callback checks the
// signature, the age, and that the cookie matches.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SCOPE = "incoming-webhook";
export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATE_COOKIE = "xpl_slack_state";

export function signState(secret, now = Date.now()) {
  const stamp = String(now);
  const mac = createHmac("sha256", secret).update(stamp).digest("hex").slice(0, 32);
  return `${stamp}.${mac}`;
}

export function verifyState(secret, state, { now = Date.now(), cookieState } = {}) {
  if (!state || typeof state !== "string") return { ok: false, reason: "missing state" };
  if (cookieState !== undefined && cookieState !== state) return { ok: false, reason: "state cookie mismatch" };
  const [stamp, mac] = state.split(".");
  if (!stamp || !mac || !/^\d+$/.test(stamp)) return { ok: false, reason: "malformed state" };
  const expected = createHmac("sha256", secret).update(stamp).digest("hex").slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  if (now - Number(stamp) > STATE_TTL_MS || Number(stamp) > now + 60_000) return { ok: false, reason: "state expired" };
  return { ok: true };
}

export function authorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

// Exchanges the code; returns the subscriber record to store.
export async function exchangeCode({ clientId, clientSecret, code, redirectUri, fetchImpl = globalThis.fetch }) {
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
  const res = await fetchImpl("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`slack oauth failed: ${data.error || `HTTP ${res.status}`}`);
  const hook = data.incoming_webhook || {};
  if (!hook.url || !hook.channel_id) throw new Error("slack oauth response has no incoming_webhook");
  return {
    team_id: (data.team && data.team.id) || "",
    team_name: (data.team && data.team.name) || "",
    channel: hook.channel || "",
    channel_id: hook.channel_id,
    webhook_url: hook.url,
    configuration_url: hook.configuration_url || "",
    created_at: new Date().toISOString(),
  };
}

export function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx > 0) out[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
    });
  return out;
}
