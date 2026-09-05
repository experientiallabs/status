// Vercel Cron target: fires the checks from OUTSIDE GitHub's scheduler.
//
// GitHub Actions runs a "*/5" cron only when it has capacity; on this repo the
// uptime checker landed about once every two hours (2026-09-04/05), so an
// eight-minute API outage could pass unseen. Vercel Cron (Pro plan, per-minute
// resolution) calls this function every 5 minutes, and it triggers the two
// GitHub workflows that listen for repository_dispatch: Upptime's checker
// (event "uptime") and the live-traffic read (event "traffic-health").
//
// Env (Vercel project, production): CRON_SECRET (Vercel sends it as the bearer
// token on cron invocations; anything else is refused) and GH_DISPATCH_TOKEN (a
// GitHub token with repo scope on experientiallabs/status).
//
// Deployed by deploy-vercel.yml, which copies vercel/ over the gh-pages tree so
// this file lands at api/cron/dispatch.js in the served root.

const REPO = "experientiallabs/status";
const EVENTS = ["uptime", "traffic-health"];

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    res.status(500).json({ error: "GH_DISPATCH_TOKEN is not configured" });
    return;
  }
  const results = {};
  for (const event of EVENTS) {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "experientiallabs-status-cron",
        },
        body: JSON.stringify({ event_type: event, client_payload: { source: "vercel-cron" } }),
      });
      // 204 is the only success for this endpoint.
      results[event] = response.status;
    } catch (error) {
      results[event] = `error: ${error && error.message ? error.message : String(error)}`;
    }
  }
  const ok = EVENTS.every((event) => results[event] === 204);
  res.status(ok ? 200 : 502).json({ ok, results, at: new Date().toISOString() });
}
