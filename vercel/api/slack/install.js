// "Add to Slack": starts the OAuth flow for the incoming-webhook scope.
// Fails closed with a plain page until the owner has configured the app
// (README "Subscriptions").
import { authorizeUrl, signState, STATE_COOKIE, STATE_TTL_MS } from "../_lib/slack-oauth.mjs";
import { createStore } from "../_lib/edge-config.mjs";
import { htmlPage } from "../_lib/http.mjs";

export const REDIRECT_URI = "https://status.experientiallabs.ai/api/slack/callback";

export default function handler(req, res) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const store = createStore();
  const missing = [];
  if (!clientId) missing.push("SLACK_CLIENT_ID");
  if (!clientSecret) missing.push("SLACK_CLIENT_SECRET");
  missing.push(...store.missing);
  if (missing.length) {
    console.log(`slack/install: not enabled, missing env ${missing.join(", ")}`);
    htmlPage(
      res,
      503,
      "Slack subscriptions are not enabled yet",
      `<div class="bad"><p>Self-service Slack subscriptions have not been switched on for this status page.</p>
<p>You can still follow updates in Slack today: in any channel run <code>/feed subscribe https://status.experientiallabs.ai/feed.xml</code>.</p></div>`
    );
    return;
  }
  const state = signState(clientSecret);
  res.setHeader(
    "set-cookie",
    `${STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}; Path=/api/slack; Secure; HttpOnly; SameSite=Lax`
  );
  res.setHeader("cache-control", "no-store");
  res.statusCode = 302;
  res.setHeader("location", authorizeUrl({ clientId, redirectUri: REDIRECT_URI, state }));
  res.end();
}
