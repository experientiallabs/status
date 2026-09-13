// Posts one incident message to the internal channel and to every stored
// subscriber webhook. Best effort: each post has its own timeout, a failure
// on one webhook never blocks the others, and a webhook Slack reports as
// gone (HTTP 404/410, or the bodies no_service / channel_not_found /
// channel_is_archived) is removed from storage so it is not retried forever.
import { slackPayload } from "./message.mjs";

export const DEAD_WEBHOOK_BODIES = new Set(["no_service", "channel_not_found", "channel_is_archived", "invalid_token"]);

export async function postWebhook(url, payload, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await res.text().catch(() => "")).trim();
    const dead = res.status === 404 || res.status === 410 || DEAD_WEBHOOK_BODIES.has(body);
    return { ok: res.ok, status: res.status, body: body.slice(0, 120), dead };
  } catch (error) {
    return { ok: false, status: 0, body: error && error.name === "AbortError" ? "timeout" : String(error && error.message || error), dead: false };
  } finally {
    clearTimeout(timer);
  }
}

// event: normalized incident event (see message.mjs).
// Returns a report the caller can log and return to the workflow.
export async function fanOut(event, { internalWebhook, store, fetchImpl = globalThis.fetch, timeoutMs = 5000, log = console.log } = {}) {
  const report = { internal: null, subscribers: 0, delivered: 0, failed: 0, removed: [] };
  const tasks = [];

  if (internalWebhook) {
    tasks.push(
      postWebhook(internalWebhook, slackPayload(event, { mention: true }), { fetchImpl, timeoutMs }).then((result) => {
        report.internal = result.ok ? "ok" : `HTTP ${result.status} ${result.body}`;
      })
    );
  } else {
    report.internal = "not configured";
  }

  let subscribers = [];
  if (store && store.configured) {
    try {
      subscribers = await store.listSubscribers();
    } catch (error) {
      report.subscribersError = String(error && error.message || error);
      log(`fanout: could not list subscribers: ${report.subscribersError}`);
    }
  } else if (store) {
    report.subscribersError = `storage not configured (missing ${store.missing.join(", ")})`;
  }
  report.subscribers = subscribers.length;

  const payload = slackPayload(event, { mention: false });
  const dead = [];
  for (const subscriber of subscribers) {
    tasks.push(
      postWebhook(subscriber.webhook_url, payload, { fetchImpl, timeoutMs }).then((result) => {
        if (result.ok) report.delivered += 1;
        else {
          report.failed += 1;
          log(`fanout: ${subscriber.team_name || subscriber.team_id} ${subscriber.channel}: HTTP ${result.status} ${result.body}`);
          if (result.dead) dead.push(subscriber.key);
        }
      })
    );
  }
  await Promise.all(tasks);

  if (dead.length) {
    try {
      await store.deleteSubscribers(dead);
      report.removed = dead;
      log(`fanout: removed ${dead.length} dead subscriber(s)`);
    } catch (error) {
      log(`fanout: could not remove dead subscribers: ${error && error.message}`);
    }
  }
  return report;
}
