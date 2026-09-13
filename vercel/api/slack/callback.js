// Slack OAuth redirect target: verifies state, exchanges the code, stores the
// channel's incoming webhook in Edge Config, posts a welcome line to the
// channel, and confirms with a small page. Nothing is written to the repo.
import { exchangeCode, parseCookies, STATE_COOKIE, verifyState } from "../_lib/slack-oauth.mjs";
import { createStore } from "../_lib/edge-config.mjs";
import { postWebhook } from "../_lib/fanout.mjs";
import { escapeHtml, htmlPage } from "../_lib/http.mjs";
import { STATUS_URL } from "../_lib/message.mjs";

const REDIRECT_URI = "https://status.experientiallabs.ai/api/slack/callback";
const clearCookie = `${STATE_COOKIE}=; Max-Age=0; Path=/api/slack; Secure; HttpOnly; SameSite=Lax`;

export default async function handler(req, res) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const store = createStore();
  if (!clientId || !clientSecret || !store.configured) {
    console.log(`slack/callback: not enabled (client ${clientId ? "set" : "missing"}, storage missing ${store.missing.join(", ") || "nothing"})`);
    htmlPage(res, 503, "Slack subscriptions are not enabled yet", `<div class="bad"><p>This status page is not configured for Slack subscriptions.</p></div>`);
    return;
  }
  const query = req.query || Object.fromEntries(new URL(req.url, "https://x").searchParams);
  res.setHeader("set-cookie", clearCookie);
  if (query.error) {
    htmlPage(res, 400, "Slack did not complete the install", `<div class="bad"><p>Slack returned <code>${escapeHtml(query.error)}</code>. Nothing was subscribed.</p></div>`);
    return;
  }
  const cookies = parseCookies(req.headers && req.headers.cookie);
  // A missing cookie is a mismatch too: the state must come back with the
  // browser that started the flow.
  const state = verifyState(clientSecret, query.state, { cookieState: cookies[STATE_COOKIE] || "" });
  if (!state.ok) {
    console.log(`slack/callback: rejected state (${state.reason})`);
    htmlPage(res, 400, "This install link has expired", `<div class="bad"><p>Please start again from the <a href="/">status page</a> (${escapeHtml(state.reason)}).</p></div>`);
    return;
  }
  if (!query.code) {
    htmlPage(res, 400, "Missing authorization code", `<div class="bad"><p>Slack did not return a code. Please start again from the <a href="/">status page</a>.</p></div>`);
    return;
  }
  let subscriber;
  try {
    subscriber = await exchangeCode({ clientId, clientSecret, code: query.code, redirectUri: REDIRECT_URI });
    await store.upsertSubscriber(subscriber);
  } catch (error) {
    console.log(`slack/callback: ${error && error.message}`);
    htmlPage(res, 502, "Could not complete the subscription", `<div class="bad"><p>${escapeHtml(error && error.message)}</p><p>Please try again in a minute.</p></div>`);
    return;
  }
  const welcome = await postWebhook(subscriber.webhook_url, {
    text: `:white_check_mark: This channel now receives Experiential Labs status updates (outages, degradations, and recoveries). Details: ${STATUS_URL}. To stop, remove the "Experiential Labs Status" app from this channel.`,
  });
  console.log(`slack/callback: subscribed ${subscriber.team_name} ${subscriber.channel} (welcome ${welcome.ok ? "ok" : `HTTP ${welcome.status}`})`);
  htmlPage(
    res,
    200,
    "Subscribed",
    `<div class="ok"><p>Subscribed <b>${escapeHtml(subscriber.channel)}</b> in <b>${escapeHtml(subscriber.team_name || subscriber.team_id)}</b>.</p>
<p>The channel gets a message when a public component goes down, is degraded, or recovers. A confirmation was just posted there.</p>
<p>To unsubscribe, remove the app from the channel in Slack${subscriber.configuration_url ? ` (<a href="${escapeHtml(subscriber.configuration_url)}">manage the webhook</a>)` : ""}.</p></div>`
  );
}
