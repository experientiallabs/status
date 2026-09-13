import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, messageText, normalizeEvent, OWNER_SLACK_ID } from "../vercel/api/_lib/message.mjs";
import { fanOut, postWebhook } from "../vercel/api/_lib/fanout.mjs";
import { createStore, parseConnection, subscriberKey } from "../vercel/api/_lib/edge-config.mjs";
import { authorizeUrl, signState, verifyState } from "../vercel/api/_lib/slack-oauth.mjs";

const url = "https://github.com/experientiallabs/status/issues/42";

test("message wording: mention only on a down opening, and only when asked", () => {
  const down = { event: "opened", component: "api", state: "down", url };
  assert.equal(messageText(down, { mention: true }), `<@${OWNER_SLACK_ID}> :red_circle: *API is down* — https://status.experientiallabs.ai — ${url}`);
  assert.equal(messageText(down), `:red_circle: *API is down* — https://status.experientiallabs.ai — ${url}`);
  const degraded = { event: "opened", component: "web", state: "degraded", url };
  assert.equal(messageText(degraded, { mention: true }), `:large_yellow_circle: *Web Dashboard has degraded performance* — https://status.experientiallabs.ai — ${url}`);
  assert.equal(messageText({ event: "closed", component: "api", state: "down", url, duration: "23 min" }, { mention: true }), `:large_green_circle: API is back up after 23 min — ${url}`);
  assert.equal(messageText({ event: "closed", component: "docs", state: "degraded", url }), `:large_green_circle: Docs performance recovered — ${url}`);
  assert.equal(messageText({ event: "reopened", component: "api", state: "down", url }), `:red_circle: *API is down* — https://status.experientiallabs.ai — ${url}`);
});

test("normalizeEvent rejects malformed bodies", () => {
  assert.throws(() => normalizeEvent({ event: "labeled", component: "api", state: "down", url }), /event must be/);
  assert.throws(() => normalizeEvent({ event: "opened", component: "api", state: "meh", url }), /state must be/);
  assert.throws(() => normalizeEvent({ event: "opened", state: "down", url }), /component/);
  assert.throws(() => normalizeEvent({ event: "opened", component: "api", state: "down", url: "javascript:alert(1)" }), /https/);
  assert.equal(formatDuration("2026-09-12T18:44:07Z", "2026-09-13T12:11:00Z"), "17 h 27 min");
});

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (target, init = {}) => {
    calls.push({ url: String(target), init });
    const route = routes.find((r) => String(target).startsWith(r.match));
    if (!route) return { ok: false, status: 599, text: async () => "unrouted", json: async () => ({}) };
    if (route.hang) await new Promise((resolve, reject) => init.signal && init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const body = typeof route.body === "function" ? route.body(init) : route.body;
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    };
  };
  return { fetchImpl, calls };
}

test("postWebhook flags dead webhooks and times out", async () => {
  const { fetchImpl } = fakeFetch([
    { match: "https://hooks/ok", status: 200, body: "ok" },
    { match: "https://hooks/gone", status: 404, body: "no_service" },
    { match: "https://hooks/archived", status: 403, body: "channel_is_archived" },
    { match: "https://hooks/flaky", status: 500, body: "server_error" },
    { match: "https://hooks/slow", status: 200, body: "ok", hang: true },
  ]);
  assert.deepEqual(await postWebhook("https://hooks/ok", { text: "x" }, { fetchImpl }), { ok: true, status: 200, body: "ok", dead: false });
  assert.equal((await postWebhook("https://hooks/gone", { text: "x" }, { fetchImpl })).dead, true);
  assert.equal((await postWebhook("https://hooks/archived", { text: "x" }, { fetchImpl })).dead, true);
  assert.equal((await postWebhook("https://hooks/flaky", { text: "x" }, { fetchImpl })).dead, false, "5xx is retried next time, not removed");
  const slow = await postWebhook("https://hooks/slow", { text: "x" }, { fetchImpl, timeoutMs: 20 });
  assert.deepEqual([slow.ok, slow.body], [false, "timeout"]);
});

test("fanOut posts internal with mention, subscribers without, removes dead ones", async () => {
  const connection = "https://edge-config.vercel.com/ecfg_abc?token=tok123";
  const items = {
    sub_T1_C1: { team_id: "T1", team_name: "Acme", channel: "#ops", channel_id: "C1", webhook_url: "https://hooks/ok" },
    sub_T2_C2: { team_id: "T2", team_name: "Beta", channel: "#alerts", channel_id: "C2", webhook_url: "https://hooks/gone" },
    unrelated: { hello: "world" },
  };
  const { fetchImpl, calls } = fakeFetch([
    { match: "https://edge-config.vercel.com/ecfg_abc/items", status: 200, body: items },
    { match: "https://api.vercel.com/v1/edge-config/ecfg_abc/items", status: 200, body: { status: "ok" } },
    { match: "https://hooks/internal", status: 200, body: "ok" },
    { match: "https://hooks/ok", status: 200, body: "ok" },
    { match: "https://hooks/gone", status: 404, body: "no_service" },
  ]);
  const store = createStore({ connection, apiToken: "vtok", teamId: "team_1", fetchImpl });
  assert.equal(store.configured, true);
  const logs = [];
  const report = await fanOut({ event: "opened", component: "api", state: "down", url }, { internalWebhook: "https://hooks/internal", store, fetchImpl, log: (m) => logs.push(m) });
  assert.equal(report.internal, "ok");
  assert.equal(report.subscribers, 2);
  assert.equal(report.delivered, 1);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.removed, ["sub_T2_C2"]);
  const internal = calls.find((c) => c.url === "https://hooks/internal");
  assert.match(JSON.parse(internal.init.body).text, new RegExp(`^<@${OWNER_SLACK_ID}> :red_circle:`));
  const sub = calls.find((c) => c.url === "https://hooks/ok");
  assert.match(JSON.parse(sub.init.body).text, /^:red_circle:/, "subscribers never get the mention");
  const del = calls.find((c) => c.url.startsWith("https://api.vercel.com/"));
  assert.equal(del.url, "https://api.vercel.com/v1/edge-config/ecfg_abc/items?teamId=team_1");
  assert.equal(del.init.headers.authorization, "Bearer vtok");
  assert.deepEqual(JSON.parse(del.init.body), { items: [{ operation: "delete", key: "sub_T2_C2" }] });
});

test("fanOut without storage still posts the internal channel", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "https://hooks/internal", status: 200, body: "ok" }]);
  const store = createStore({ connection: undefined, apiToken: undefined, fetchImpl });
  assert.equal(store.configured, false);
  assert.deepEqual(store.missing, ["EDGE_CONFIG", "VERCEL_TOKEN"]);
  const report = await fanOut({ event: "closed", component: "api", state: "down", url, duration: "8 min" }, { internalWebhook: "https://hooks/internal", store, fetchImpl, log: () => {} });
  assert.equal(report.internal, "ok");
  assert.equal(report.subscribers, 0);
  assert.match(report.subscribersError, /not configured/);
  assert.equal(calls.length, 1);
});

test("edge config helpers", () => {
  assert.deepEqual(parseConnection("https://edge-config.vercel.com/ecfg_abc?token=t"), { id: "ecfg_abc", token: "t", origin: "https://edge-config.vercel.com" });
  assert.equal(parseConnection("nonsense"), null);
  assert.equal(parseConnection(""), null);
  assert.equal(subscriberKey("T0/1", "C.2"), "sub_T01_C2");
});

test("oauth state round-trips, expires, and is bound to the cookie", () => {
  const secret = "s3cret";
  const now = 1_800_000_000_000;
  const state = signState(secret, now);
  assert.equal(verifyState(secret, state, { now: now + 1000, cookieState: state }).ok, true);
  assert.equal(verifyState(secret, state, { now: now + 1000, cookieState: "other" }).reason, "state cookie mismatch");
  assert.equal(verifyState("wrong", state, { now: now + 1000 }).reason, "bad signature");
  assert.equal(verifyState(secret, state, { now: now + 11 * 60 * 1000 }).reason, "state expired");
  assert.equal(verifyState(secret, "garbage", { now }).reason, "malformed state");
  const authorize = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://status.experientiallabs.ai/api/slack/callback", state }));
  assert.equal(authorize.origin + authorize.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(authorize.searchParams.get("scope"), "incoming-webhook");
  assert.equal(authorize.searchParams.get("state"), state);
});
