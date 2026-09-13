// Fan-out endpoint: POST one incident event, it reaches the internal channel
// (with the owner mention on a down opening) and every self-service Slack
// subscriber (never mentioned). Called by slack-mention.yml.
//
//   POST /api/notify
//   Authorization: Bearer <NOTIFY_TOKEN>
//   { "event": "opened"|"closed", "component": "api", "state": "down"|"degraded",
//     "title": "...", "url": "https://github.com/.../issues/N", "duration": "23 min" }
//
// Env (Vercel project): NOTIFY_TOKEN (required; without it every call is 503
// so an unconfigured endpoint can never be used to spam subscribers),
// NOTIFICATION_SLACK_WEBHOOK_URL (internal channel, optional), EDGE_CONFIG +
// VERCEL_TOKEN (+ VERCEL_ORG_ID) for the subscriber list (optional; without
// them only the internal channel is posted).
import { fanOut } from "./_lib/fanout.mjs";
import { createStore } from "./_lib/edge-config.mjs";
import { normalizeEvent, slackPayload } from "./_lib/message.mjs";
import { bearer, readJsonBody, tokenMatches } from "./_lib/http.mjs";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "POST only" });
    return;
  }
  const expected = process.env.NOTIFY_TOKEN;
  if (!expected) {
    console.log("notify: NOTIFY_TOKEN is not configured; refusing");
    res.status(503).json({ error: "notifications are not enabled (NOTIFY_TOKEN unset)" });
    return;
  }
  if (!(await tokenMatches(bearer(req), expected))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  let event;
  try {
    event = normalizeEvent(await readJsonBody(req));
  } catch (error) {
    res.status(400).json({ error: String(error && error.message || error) });
    return;
  }
  const dryRun = req.query && (req.query.dry_run === "1" || req.query.dry_run === "true");
  const store = createStore();
  if (dryRun) {
    let subscribers = 0;
    if (store.configured) subscribers = (await store.listSubscribers().catch(() => [])).length;
    res.status(200).json({
      dry_run: true,
      internal: process.env.NOTIFICATION_SLACK_WEBHOOK_URL ? slackPayload(event, { mention: true }) : "not configured",
      subscriber_payload: slackPayload(event, { mention: false }),
      subscribers,
      storage: store.configured ? "edge-config" : `not configured (missing ${store.missing.join(", ")})`,
    });
    return;
  }
  const report = await fanOut(event, { internalWebhook: process.env.NOTIFICATION_SLACK_WEBHOOK_URL, store });
  console.log(`notify: ${event.event} ${event.component} ${event.state}: internal=${report.internal} subscribers=${report.subscribers} delivered=${report.delivered} failed=${report.failed} removed=${report.removed.length}`);
  res.status(200).json(report);
}
