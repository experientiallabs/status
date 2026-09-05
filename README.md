# Experiential Labs Status

Public status page for the Experiential Labs platform, served at
**[status.experientiallabs.ai](https://status.experientiallabs.ai)**, powered by
[Upptime](https://upptime.js.org) (MIT).

Checks run every 5 minutes from GitHub Actions and the page is a static site
served by Vercel, so the status page shares **no infrastructure** with the
platform: no Porter cluster, no Supabase, no shared pooler. If the platform is
down, this page stays up and says so.

## What is monitored

| Component           | Check                                                            | Healthy when                                                                                            |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Web Dashboard       | `GET platform.experientiallabs.ai/signin` (light, always-public) | 200                                                                                                     |
| API                 | `GET api.experientiallabs.ai/v1/models`, unauthenticated         | **401**; the app rejecting the request proves edge + gateway worker + auth are alive, and a 5xx is down |
| Docs                | `GET platform.experientiallabs.ai/docs`                          | 200                                                                                                     |
| Gateway (authenticated) | `GET api.experientiallabs.ai/v1/models` with the status-monitor org key | 200; proves key auth, the gateway's Postgres path, and the catalog serve a signed-in caller |
| API, live traffic   | Gateway ledger, last 15 minutes of real customer requests        | Rendered on the API row; gateway-owned error rate and volume vs baseline (below)                        |
| Gateway Completions | `POST /v1/chat/completions`, a real 1-token completion           | 200; disabled until the status-monitor org is funded (below)                                            |

All checks live in [`.upptimerc.yml`](./.upptimerc.yml). That file is the single
source of truth: the workflows in `.github/workflows` are generated from it by
Upptime's `update-template` command, and Setup CI regenerates them on every push
that touches the config. Change the config, not the workflows.

## Posting an incident or maintenance notice

Incidents are GitHub Issues on this repository.

- **Automatic:** when a check fails, Upptime opens an issue labeled `status` and
  `down` (or `degraded`), assigns it, and shows it on the status page. When the
  check recovers, the issue is closed automatically and becomes part of the
  incident history.
- **Manual incident:** open an issue with the `status` label. Add the label
  matching the affected component's slug (`web`, `api`, `docs`, `gateway`) to
  attach it to that component. The issue title is the incident headline; comments
  are updates. Close the issue to resolve it.
- **Scheduled maintenance:** open an issue with the `maintenance` label and put
  the window in an HTML comment in the body (slugs are comma-separated):

  ```
  <!--
  start: 2026-09-01T06:00:00Z
  end: 2026-09-01T06:30:00Z
  expectedDown: api, gateway
  -->
  ```

  During the window the listed components fail without opening a new incident,
  and Upptime closes and locks the issue automatically once `end` passes.

## Live traffic health (real customer requests)

Synthetic checks prove the door opens; they cannot see whether the requests
customers are actually sending succeed. `traffic-health.yml` (hand-maintained,
every 5 minutes) reads the production gateway ledger through the read-only
`PROD_OPS_AGENT_DB_URL` role and writes `assets/status-ui/traffic-health.json`,
which the status-ui overlay renders on the API row as
"Live traffic: X% failed inside the gateway (N requests, last 15 min)". When
the verdict is degraded or down, the API row's pill and the summary banner say
so ("Degraded (live traffic)"), because the checker can be green while real
requests fail (2026-09-05: 24% of requests failed for 35 minutes with
/v1/models answering normally). The uptime percentages and 90-day bars stay on
Upptime's incident data, so the two figures can legitimately disagree: uptime is
"could the API be reached", live traffic is "did requests succeed right now".

- **Gateway errors** count only failures the gateway owns (terminal classes
  `internal` and `unavailable`). Customer rejections (quota, invalid request)
  and upstream provider errors are excluded on purpose: a customer out of
  credits is not an outage, and a provider incident is reported by the provider.
- **Baseline** is the 7-day median request count for the same 15-minute slot at
  this hour, so a traffic collapse is detected even when nothing errors.
- **Verdicts.** Down: 25% or more gateway errors over at least 20 finished
  requests, zero requests against a baseline of 20 or more, or the database
  unreachable on two consecutive checks (the gateway's readiness gates on a
  live database ping, so that is an API outage). Degraded: 5% or more gateway
  errors, or under a fifth of the baseline volume. Thresholds live at the top
  of the workflow's Python step.
- **Alerts.** A non-ok verdict opens one GitHub issue labeled `traffic-alert`
  (assigned to the owner) and posts to Slack; recovery closes the issue and
  posts again. These issues carry a different label from Upptime's `status`
  incidents, so the uptime percentages and 90-day bars keep their single source.

## Alerts

Two independent alert paths, both to the same Slack incoming webhook:

1. **Checker incidents** (Upptime): set both repository secrets together,
   `NOTIFICATION_SLACK=true` and `NOTIFICATION_SLACK_WEBHOOK_URL=<url>`. Both
   names are on the `secrets` allowlist in `.upptimerc.yml`. Upptime posts on
   down, degraded, and recovery, and still opens the incident issue and assigns
   the owner (GitHub emails the assignee) whether or not Slack is configured.
2. **Traffic alerts** (this repo's workflow): reads the same
   `NOTIFICATION_SLACK_WEBHOOK_URL`; with it unset, the GitHub issue is the alert.

### Why the checks are fired from Vercel, not GitHub's cron

GitHub runs a scheduled workflow only when it has capacity. On this repo the
checker's `*/5` cron landed about once every two hours (measured 2026-09-04/05),
which would let an eight-minute API outage pass unseen. So the schedule is a
fallback only: a Vercel Cron (`vercel/vercel.json`, every 5 minutes, Pro plan)
calls `/api/cron/uptime` on :00/:05/... and `/api/cron/traffic` two minutes
later (`vercel/api/cron/*.js`, copied into the served root by
`deploy-vercel.yml`); each sends one `repository_dispatch` event, `uptime` or
`traffic-health`. The offset matters: both workflows commit to main and
Upptime's checker pushes without rebasing, so firing them together made the
checker lose the push race. Vercel project env (production):
`CRON_SECRET` (Vercel presents it as the bearer token; anything else is 401) and
`GH_DISPATCH_TOKEN` (a GitHub token with repo scope on this repo). The local
copy of `CRON_SECRET` sits next to the probe key in the owner's
`~/.gateway-secrets/status-monitor.env`.

Known gap: `GH_PAT` lacks the `workflow` scope, so Upptime's Setup CI cannot
push regenerated workflows (its push of `graphs.yml` is rejected). Until the PAT
is re-scoped, `SECRETS_CONTEXT` in the generated workflows is mirrored by hand
when the `secrets` allowlist changes.

## Enabling the gateway probes

`Gateway (authenticated)` is live: the `status-monitor` organization on the
platform (slug `status-monitor`, key named "status-page authenticated probe")
holds the `STATUS_GATEWAY_API_KEY` secret. Never point this at a customer or
house org key: the key sits in this repo's Actions secrets and is sent from
GitHub runners.

The commented `Gateway Completions` site (a real completion through the
serving path) additionally needs the status-monitor org funded with a small
credit grant; an unfunded request is a 429, not a 200. Once funded, uncomment
the site and push; Setup CI regenerates the workflows.

Rotate the key like any other production credential (revoke it in the platform,
mint a new one under the same org, `gh secret set STATUS_GATEWAY_API_KEY
--repo experientiallabs/status`); it is referenced only as
`$STATUS_GATEWAY_API_KEY` in config and never appears in the repo, the page, or
committed history.

## Hosting and deploys

The site is **built** on GitHub and **served** by Vercel:

- **Static Site CI** exports the page onto the `gh-pages` branch (the artifact
  branch; keep it). GitHub Pages serving is deliberately NOT used: its
  Let's Encrypt issuance for `status.experientiallabs.ai` was terminally stuck
  in `bad_authz` despite verified-correct DNS/CAA, so the custom domain moved
  to Vercel.
- **Deploy to Vercel** (`deploy-vercel.yml`, hand-maintained, not
  Upptime-generated) runs after every successful Static Site CI (or manually
  via workflow_dispatch) and ships the `gh-pages` tree to the Vercel project
  `status` (team `experiential-labs`) with a pinned `vercel@59.5.0` CLI.
  Between deploys the page still updates live: uptime numbers and incidents
  are fetched client-side from the GitHub API.
- Deployment protection is disabled on the Vercel project on purpose: a public
  status page must be reachable by anyone.
- **Statuspage-style UI** (90-day per-day uptime bars under each component,
  and a dated Past Incidents section including "No incidents reported." days)
  is one client-side file, `assets/status-ui/uptime-bars.js`, which the deploy
  workflow overlays into the served tree at `/ui/` (referenced from
  `customHeadHtml`). Its data needs no pipeline of its own: the bars read the
  `dailyMinutesDown` map Upptime already computes from incident issues and
  commits into `history/summary.json`, and the incident list reads the repo's
  `status`-labeled issues, the same sources Upptime's own uptime numbers use.
  Bar colors: green = no downtime, orange = under an hour down, red = an hour
  or more. The `dailyMinutesDown` map is the single source for both the bars
  and the legend percentage, so they cannot diverge. Days before monitoring
  began (2026-08-25) render operational: the owner decided (Aug 2026) that
  pre-monitoring incident history belongs in the ops timeline, not on this
  page. The favicon is the vendored `assets/logo.svg` / `logo-192.png`.
- DNS: Namecheap CNAME record, host `status`, value `cname.vercel-dns.com.`
  (Vercel issues and renews the TLS certificate automatically.)

### Required repository secrets

| Secret                                                 | Why                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GH_PAT`                                               | The enterprise forces the default `GITHUB_TOKEN` to read-only; without a fine-grained PAT (this repo only; Contents + Issues read/write) Upptime cannot commit history, open incident issues, or push `gh-pages`. |
| `VERCEL_TOKEN`                                         | Deploys the site; scoped to the `experiential-labs` Vercel team.                                                                                                                                                  |
| `VERCEL_ORG_ID`                                        | Team id written into `.vercel/project.json` at deploy time.                                                                                                                                                       |
| `PROD_OPS_AGENT_DB_URL`                                | Read-only, connection-capped prod role for the server-latency and traffic-health workflows.                                                                                                                       |
| `STATUS_GATEWAY_API_KEY`                               | The status-monitor org's key behind the authenticated gateway probe.                                                                                                                                              |
| `NOTIFICATION_SLACK`, `NOTIFICATION_SLACK_WEBHOOK_URL` | Optional, set together: Slack alerts from the checker and from traffic-health.                                                                                                                                    |

## Versioning and upkeep

- Monitor workflows are pinned to `upptime/uptime-monitor@v1.43.15`.
- `update-template.yml` and `updates.yml` are Upptime's own self-update lane
  (they track upstream `master` by design and rewrite the generated workflows on
  a daily schedule). To freeze the version entirely, disable those two workflows
  in the Actions UI and bump the pin manually via a config push.
- Response-time history and graphs are committed to this repo by the bot; that
  is expected and is what powers the history on the page.
