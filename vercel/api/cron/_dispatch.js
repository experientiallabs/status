// Shared by the two Vercel Cron functions in this directory (the underscore
// keeps this file from being deployed as a function itself).
//
// Why Vercel Cron at all: GitHub Actions runs a "*/5" cron only when it has
// capacity; on this repo the uptime checker landed about once every two hours
// (2026-09-04/05), so an eight-minute API outage could pass unseen. Vercel Cron
// (Pro plan, per-minute resolution) calls these functions, which trigger the
// GitHub workflows listening for repository_dispatch.
//
// Why two functions on offset schedules: the checker and the traffic read both
// commit to main, and Upptime's checker pushes without rebasing, so firing them
// in the same second made the checker lose the race and fail. uptime runs on
// :00/:05/..., traffic-health two minutes later.
//
// Env (Vercel project, production): CRON_SECRET (Vercel sends it as the bearer
// token on cron invocations; anything else is refused) and GH_DISPATCH_TOKEN (a
// GitHub token with repo scope on experientiallabs/status).

const REPO = "experientiallabs/status";

export async function dispatch(req, res, event) {
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
  let status;
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
    status = response.status;
  } catch (error) {
    status = `error: ${error && error.message ? error.message : String(error)}`;
  }
  const ok = status === 204;
  res.status(ok ? 200 : 502).json({ ok, event, status, at: new Date().toISOString() });
}
