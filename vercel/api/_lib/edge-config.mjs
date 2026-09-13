// Subscriber storage in Vercel Edge Config, zero dependencies.
//
// Reads go to the Edge Config read endpoint with the token embedded in the
// EDGE_CONFIG connection string ("https://edge-config.vercel.com/ecfg_…?token=…").
// Writes go through the Vercel REST API (PATCH /v1/edge-config/{id}/items)
// with VERCEL_TOKEN (+ VERCEL_ORG_ID as teamId). One item per subscriber,
// key `sub_<team_id>_<channel_id>`, so concurrent installs upsert
// independently instead of racing on one array. Subscriber webhooks are
// secrets: they live here, never in the git repo.
//
// Capacity: Edge Config stores are 64 KB on Pro; a subscriber is ~300 bytes,
// so a few hundred channels fit. Past that, move to Vercel KV (README).

export const SUBSCRIBER_PREFIX = "sub_";

export function parseConnection(connection = process.env.EDGE_CONFIG) {
  if (!connection) return null;
  let url;
  try {
    url = new URL(connection);
  } catch {
    return null;
  }
  const id = url.pathname.replace(/^\/+/, "").split("/")[0];
  const token = url.searchParams.get("token");
  if (!id || !token) return null;
  return { id, token, origin: url.origin };
}

export function subscriberKey(teamId, channelId) {
  const clean = (value) => String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
  return `${SUBSCRIBER_PREFIX}${clean(teamId)}_${clean(channelId)}`;
}

export function createStore({
  connection = process.env.EDGE_CONFIG,
  apiToken = process.env.VERCEL_TOKEN,
  teamId = process.env.VERCEL_ORG_ID,
  fetchImpl = globalThis.fetch,
  apiOrigin = "https://api.vercel.com",
} = {}) {
  const parsed = parseConnection(connection);
  const missing = [];
  if (!parsed) missing.push("EDGE_CONFIG");
  if (!apiToken) missing.push("VERCEL_TOKEN");
  const configured = missing.length === 0;

  async function listSubscribers() {
    if (!parsed) throw new Error("EDGE_CONFIG is not configured");
    const res = await fetchImpl(`${parsed.origin}/${parsed.id}/items?token=${encodeURIComponent(parsed.token)}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) throw new Error(`edge config read failed: HTTP ${res.status}`);
    const items = await res.json();
    return Object.entries(items || {})
      .filter(([key, value]) => key.startsWith(SUBSCRIBER_PREFIX) && value && typeof value.webhook_url === "string")
      .map(([key, value]) => ({ key, ...value }));
  }

  async function patch(operations) {
    if (!configured) throw new Error(`storage not configured (missing ${missing.join(", ")})`);
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    const res = await fetchImpl(`${apiOrigin}/v1/edge-config/${parsed.id}/items${query}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ items: operations }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`edge config write failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  return {
    configured,
    missing,
    listSubscribers,
    upsertSubscriber(subscriber) {
      const key = subscriberKey(subscriber.team_id, subscriber.channel_id);
      return patch([{ operation: "upsert", key, value: subscriber }]);
    },
    deleteSubscribers(keys) {
      if (!keys.length) return Promise.resolve({});
      return patch(keys.map((key) => ({ operation: "delete", key })));
    },
  };
}
