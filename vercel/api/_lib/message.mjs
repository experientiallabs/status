// The ONE place the Slack incident message is worded. Used by /api/notify
// (internal channel + every subscriber) and, until NOTIFY_TOKEN is configured,
// by slack-mention.yml directly on the runner (node -e). Keep it free of any
// Vercel or network code so both callers can import it.

export const STATUS_URL = "https://status.experientiallabs.ai";
export const OWNER_SLACK_ID = "U0B6Y9K9C00";
const NAMES = { api: "API", web: "Web Dashboard", docs: "Docs", gateway: "Gateway", dashboard: "Dashboard (signed in)" };

export function componentName(component) {
  return NAMES[component] || component || "component";
}

// Validates and normalizes the event body every caller sends:
//   { event: "opened"|"closed", component, state: "down"|"degraded",
//     title?, url, duration? }
export function normalizeEvent(input) {
  const body = input && typeof input === "object" ? input : {};
  const event = body.event === "reopened" ? "opened" : body.event;
  if (!["opened", "closed"].includes(event)) throw new Error(`event must be opened or closed, got ${JSON.stringify(body.event)}`);
  if (!["down", "degraded"].includes(body.state)) throw new Error(`state must be down or degraded, got ${JSON.stringify(body.state)}`);
  if (typeof body.component !== "string" || !body.component) throw new Error("component is required");
  if (typeof body.url !== "string" || !/^https:\/\//.test(body.url)) throw new Error("url must be an https URL");
  return {
    event,
    component: body.component,
    state: body.state,
    title: typeof body.title === "string" ? body.title : "",
    url: body.url,
    duration: typeof body.duration === "string" ? body.duration : "",
  };
}

// Slack text for one event. `mention` prefixes the owner on a down opening;
// only the internal channel gets that, subscribers never do.
export function messageText(event, { mention = false } = {}) {
  const e = normalizeEvent(event);
  const name = componentName(e.component);
  if (e.event === "opened") {
    if (e.state === "down") {
      const prefix = mention ? `<@${OWNER_SLACK_ID}> ` : "";
      return `${prefix}:red_circle: *${name} is down* — ${STATUS_URL} — ${e.url}`;
    }
    return `:large_yellow_circle: *${name} has degraded performance* — ${STATUS_URL} — ${e.url}`;
  }
  const took = e.duration ? ` after ${e.duration}` : "";
  return e.state === "down"
    ? `:large_green_circle: ${name} is back up${took} — ${e.url}`
    : `:large_green_circle: ${name} performance recovered${took} — ${e.url}`;
}

export function slackPayload(event, options) {
  return { text: messageText(event, options) };
}

// "17 h 26 min" / "23 min" from two ISO timestamps.
export function formatDuration(start, end) {
  const minutes = Math.max(1, Math.round((new Date(end) - new Date(start)) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${rest} min` : `${minutes} min`;
}
