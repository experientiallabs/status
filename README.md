# Experiential Labs Status

Public status page for the Experiential Labs platform, served at
**[status.experientiallabs.ai](https://status.experientiallabs.ai)**, powered by
[Upptime](https://upptime.js.org) (MIT).

Checks run every 5 minutes from GitHub Actions and the page is a static site
served by Vercel, so the status page shares **no infrastructure** with the
platform: no Porter cluster, no Supabase, no shared pooler. If the platform is
down, this page stays up and says so.

## What is monitored

| Component               | Check                                                                   | Healthy when                                                                                            |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Web Dashboard           | `GET platform.experientiallabs.ai/signin` (light, always-public)        | 200                                                                                                     |
| API                     | `GET api.experientiallabs.ai/v1/models`, unauthenticated                | **401**; the app rejecting the request proves edge + gateway worker + auth are alive, and a 5xx is down |
| Docs                    | `GET platform.experientiallabs.ai/docs`                                 | 200                                                                                                     |
| Gateway (authenticated) | `GET api.experientiallabs.ai/v1/models` with the status-monitor org key | 200; proves key auth, the gateway's Postgres path, and the catalog serve a signed-in caller             |
| API, live traffic       | Gateway ledger, last 15 minutes of real customer requests               | Rendered on the API row; gateway-owned error rate and volume vs baseline (below)                        |
| Gateway Completions     | `POST /v1/chat/completions`, a real 1-token completion                  | 200; disabled until the status-monitor org is funded (below)                                            |

All checks live in [`.upptimerc.yml`](./.upptimerc.yml). That file is the single
source of truth: the workflows in `.github/workflows` are generated from it by
Upptime's `update-template` command, and Setup CI regenerates them on every push
that touches the config. Change the config, not the workflows.

## Posting an incident or maintenance notice

The page's 90-day bars, uptime percentages, and dated Past Incidents section all
read ONE record: `assets/status-ui/incidents.json` (curated) merged with the
checker's live `status`-labelled issues opened after the record's
`liveIssuesSince`. Edits to the JSON take effect on the next page load (it is
fetched from raw `main`); no redeploy.

- **Automatic:** when a check fails, Upptime opens an issue labeled `status` and
  the component slug, assigns it, and the page lists it from its `created_at`
  until it is closed. When the check recovers the issue is closed automatically;
  if that closing run fails, the stale-incident reconciler (below) closes it
  within 15 minutes. If an issue turns out to be a monitoring artifact (revoked
  probe key, runner network blip, an issue that lingered open after recovery),
  add its number to `annulledIssues` in the JSON and remove its `status` label
  so neither the page nor Upptime counts it.
- **Curated incident (the normal way to record what actually happened):** add an
  entry to `incidents` with `component` (`api`, `web`, `docs`), `severity`
  (`down` = not serving, counts against uptime; `degraded` = serving with
  elevated errors or latency, shown in yellow, not counted), UTC `start`/`end`
  set to when the effect actually started and stopped (from the gateway ledger,
  deploy runs, or logs — not when an issue was opened or closed), a short
  `title`, and a one- or two-sentence technical `description` (what failed,
  why, what fixed it, with the fix time). Keep entries minimal and factual.
- **Manual incident via issue:** open an issue with the `status` label and the
  component slug label. The issue title is the headline; comments are updates.
  Close the issue to resolve it; the page shows the open-to-close window as the
  duration, so close it when the effect ends, not later.
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

## Subscriptions

Anyone can follow incidents without watching the page. Everything below reads
the same merged record the page renders (curated `incidents.json` plus the
checker's live `status` issues after `liveIssuesSince`, minus
`annulledIssues`), so a subscriber never sees something the page does not.

- **Atom feed:** `https://status.experientiallabs.ai/feed.xml` (`/feed`
  redirects there; the page carries a `<link rel="alternate">` for feed
  readers). One entry per incident: title `Outage|Degraded: <component> —
  <title>` with "(ongoing)" while open, the UTC window, the duration, the
  description, and a link to the incident page (checker issues) or the status
  page (curated entries). Ids are stable
  (`tag:status.experientiallabs.ai,2026:<incident id>`); an entry's `updated`
  is its end, or now while it is ongoing, and the feed's `updated` is the
  newest entry. The XML is `assets/status-ui/feed.xml`, rebuilt by `feed.yml`
  (hand-maintained) whenever a `status` issue is opened, edited, labelled,
  or closed, when the curated record or the merge code changes, hourly as a
  fallback, or by hand; it commits only when the bytes changed and runs in
  Upptime's concurrency group because it pushes to main. The builder,
  `scripts/build-feed.mjs`, does not re-implement the merge: it evaluates the
  `mergedIncidents` block of `uptime-bars.js` between its `@shared-begin` /
  `@shared-end` markers verbatim (`tests/feed.test.mjs` guards that). Serving:
  `vercel/vercel.json` rewrites `/feed.xml` to `/api/feed`, a proxy that reads
  the XML from raw `main` and sets `Content-Type: application/atom+xml` with a
  60 s edge cache (raw GitHub serves it as text/plain, and reading raw main
  means a rebuild needs no redeploy).
- **Slack, zero setup:** in any channel run
  `/feed subscribe https://status.experientiallabs.ai/feed.xml` (Slack's
  built-in RSS app). Slack polls the feed; expect a few minutes of delay.
- **Slack, "Add to Slack" (self-service, owner enables):** a Slack app with
  only the `incoming-webhook` scope. The button on the page (rendered when
  `assets/status-ui/subscribe.json` says `slackAppEnabled: true`) goes to
  `/api/slack/install`, which redirects to Slack OAuth with a signed, cookie-
  bound `state`; `/api/slack/callback` exchanges the code, receives the
  channel's incoming webhook, stores it, posts a confirmation to the channel,
  and shows "Subscribed #channel in <team>". Subscriber webhooks are secrets,
  so they are stored in **Vercel Edge Config**, never in this repo: one item
  per channel (`sub_<team_id>_<channel_id>`), read through the `EDGE_CONFIG`
  connection string, written through the Vercel REST API with `VERCEL_TOKEN`.
  Edge Config is 64 KB on Pro (a few hundred channels); past that, move the
  store to Vercel KV behind the same `createStore` interface
  (`vercel/api/_lib/edge-config.mjs`). To unsubscribe, a workspace removes
  the app from the channel; the next post to a webhook Slack reports as gone
  (HTTP 404/410, `no_service`, `channel_not_found`, `channel_is_archived`)
  deletes the subscriber.
- **Fan-out:** `POST /api/notify` (Bearer `NOTIFY_TOKEN`, body
  `{event: opened|closed, component, state: down|degraded, title, url,
  duration}`) posts one message to the internal channel
  (`NOTIFICATION_SLACK_WEBHOOK_URL`, with the owner mention on a down opening)
  and, without the mention, to every subscriber, best effort with a 5 s
  timeout per webhook. `?dry_run=1` returns the payloads and subscriber count
  without posting. Without `NOTIFY_TOKEN` in the Vercel env every call is 503,
  so an unconfigured endpoint can never be used to spam subscribers.
  `slack-mention.yml` calls it when the repo secret `NOTIFY_TOKEN` is set and
  otherwise posts the internal channel directly from the runner; both paths
  word the message with `vercel/api/_lib/message.mjs`, the one place the text
  lives.
- **Webhook / other:** the JSON record is public at
  `https://raw.githubusercontent.com/experientiallabs/status/main/assets/status-ui/incidents.json`
  and the live issues at
  `https://api.github.com/repos/experientiallabs/status/issues?labels=status`;
  the feed is the stable, merged view of both.

### Enabling "Add to Slack" (owner)

Nothing here is required for the feed or the `/feed subscribe` path; those work
as soon as this is merged and deployed.

1. Create the Slack app from the manifest: <https://api.slack.com/apps> →
   Create New App → From a manifest → pick the Experiential Labs workspace →
   paste `slack-app-manifest.yml`. Under **Manage Distribution**, activate
   public distribution (other workspaces must be able to install it). Copy the
   **Client ID** and **Client Secret** from Basic Information.
2. Create the Edge Config store (Vercel dashboard → Storage → Edge Config, or
   `POST https://api.vercel.com/v1/edge-config?teamId=<VERCEL_ORG_ID>` with the
   Vercel token) and connect it to the `status` project; that adds the
   `EDGE_CONFIG` connection string to the project env.
3. Generate one shared token and set it in both places:

   ```bash
   NOTIFY_TOKEN=$(openssl rand -hex 32)
   gh secret set NOTIFY_TOKEN --repo experientiallabs/status --body "$NOTIFY_TOKEN"
   npx -y vercel@59.5.0 env add NOTIFY_TOKEN production --token "$VERCEL_TOKEN" --scope experiential-labs <<< "$NOTIFY_TOKEN"
   ```

4. Vercel project env (production), all required for the install flow:
   `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `EDGE_CONFIG` (from step 2),
   `VERCEL_TOKEN` (a token that can write Edge Config in the team; a dedicated
   token is better than reusing the deploy token), `VERCEL_ORG_ID` (team id,
   used as `teamId` on writes), `NOTIFY_TOKEN` (step 3), and
   `NOTIFICATION_SLACK_WEBHOOK_URL` (the internal channel, same value as the
   repo secret) so `/api/notify` can post it. Redeploy (Deploy to Vercel →
   Run workflow) so the functions see the new env.
5. Flip `slackAppEnabled` to `true` in `assets/status-ui/subscribe.json` and
   push; the button appears on the next page load. Test the whole chain from
   the Actions tab: Slack Mention → Run workflow with `dry_run` off,
   `action: closed`, `state: degraded` (a harmless recovery line reaches the
   internal channel and every subscriber).

If any env is missing, `/api/slack/install` returns a 503 page ("Slack
subscriptions are not enabled yet") that points at the `/feed subscribe`
path, and `/api/notify` returns 503; both log which variable is missing.

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

## Anything that pushes to `main` must share Upptime's concurrency group

Upptime's generated workflows (Uptime CI, Response Time CI, Graphs CI,
Summary CI) all run under the concurrency group
`${{ github.repository }}-${{ github.head_ref || github.ref_name }}-upptime`
with `cancel-in-progress: false`, so their commits to `main` are serialized.
`upptime/uptime-monitor` pushes without rebasing and has no retry: if any other
commit lands on `main` while a checker run is in flight, that run dies with
`! [rejected] main -> main (fetch first)`.

That is not a cosmetic failure. The checker commits `history/<slug>.yml` and
closes the incident issue in the same run, so when the rejected push is the
recovery run the history already says `status: up`, the next runs see the
component up and skip the incident step, and the issue stays open until the
next transition. Issue #13 (2026-09-12) stayed open 17 h 26 min that way for a
~30-minute degradation, and because Upptime counts open-to-close as downtime it
put the API at 27% uptime for the day.

Rule: **every hand-maintained workflow that pushes to `main` uses the same
group** (`traffic-health.yml`, `server-latency.yml` and `feed.yml` do), never with
`cancel-in-progress: true` (a cancel would hit whichever checker run holds the
group), and keeps the `git pull --rebase` retry loop as a second line of
defence. `deploy-vercel.yml` does not push and keeps its own group.

### Stale-incident reconciler

`stale-incidents.yml` (hand-maintained) is the safety net for the case above. It
runs on the same `traffic-health` dispatch the Vercel cron fires two minutes
after the checker (GitHub's `*/15` schedule is the fallback) and, for every open
`status`-labelled issue the checker authored, reads that component's
`history/<slug>.yml` from `main`. If the file reads `status: up` and its
`lastUpdated` is more than 10 minutes after the issue's `created_at`, the
recovery run failed before closing the issue, so the reconciler closes it with a
comment saying so. It runs with `github.token` (`permissions: issues: write`),
so the comment is authored by `github-actions[bot]`. It ignores manual incidents
(issues whose body is not Upptime's template), `maintenance` issues, and
`traffic-alert` issues, which `traffic-health.yml` owns.

## Alerts

Three alert paths, all to the same Slack incoming webhook
(`NOTIFICATION_SLACK_WEBHOOK_URL`, the `#experiential-platform` webhook):

1. **Checker incidents** (Upptime): set both repository secrets together,
   `NOTIFICATION_SLACK=true` and `NOTIFICATION_SLACK_WEBHOOK_URL=<url>`. Both
   names are on the `secrets` allowlist in `.upptimerc.yml`. Upptime posts on
   down, degraded, and recovery, and still opens the incident issue and assigns
   the owner (GitHub emails the assignee) whether or not Slack is configured.
2. **Traffic alerts** (this repo's workflow): reads the same
   `NOTIFICATION_SLACK_WEBHOOK_URL`; with it unset, the GitHub issue is the alert.
3. **Owner @mention on a public outage** (`slack-mention.yml`, hand-maintained):
   Upptime's Slack posts cannot mention anyone, so this workflow listens to the
   checker's incident issues (`status` plus `web`, `api`, or `docs`; the
   `gateway` probe row and `traffic-alert` issues are ignored). When a
   "`<name> is down`" issue is opened it posts `<@U0B6Y9K9C00>` (the owner's
   Slack user id) followed by the outage, the status page, and the issue link;
   a degraded incident posts without a mention; closing posts a recovery line
   with the open-to-close duration. With the repo secret `NOTIFY_TOKEN` set the
   event goes through `/api/notify`, which also reaches every self-service
   Slack subscriber (see Subscriptions); otherwise the runner posts the
   internal channel directly. With nothing configured it logs "webhook not
   configured" and exits green. Test it without an incident from the Actions
   tab (Run workflow, `dry_run` on prints the payload instead of posting; off
   posts a clearly simulated message).

Neither secret is set today, so the only alert has been the GitHub issue and
its assignee email. To turn Slack on, set both:

```bash
gh secret set NOTIFICATION_SLACK_WEBHOOK_URL --repo experientiallabs/status --body 'https://hooks.slack.com/services/…'
gh secret set NOTIFICATION_SLACK --repo experientiallabs/status --body 'true'
```

Authorship: Upptime opens incident issues, comments on them, and closes them
with `GH_PAT`, so on GitHub every checker action appears to come from whoever
owns that token (currently a personal token, so the incidents read as if the
owner typed them). The fix is a dedicated bot account (a machine user with
write access to this repo) whose fine-grained PAT replaces `GH_PAT`; the
reconciler and the mention workflow already use `github.token` and do not have
this problem.

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

`Gateway (authenticated)` is currently DISABLED (commented out in
`.upptimerc.yml` since 2026-09-07): its probe key was revoked on 2026-09-05 and
no replacement has been minted, so the row would only report a false `down`.
When enabled, the `status-monitor` organization on the platform (slug
`status-monitor`, key named "status-page authenticated probe") holds the
`STATUS_GATEWAY_API_KEY` secret. Never point this at a customer or
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

### If the `Gateway (authenticated)` row is red

**Check the probe key before assuming an outage.** This row sends
`STATUS_GATEWAY_API_KEY` to `/v1/models` and expects `200`; a **`401`** means the
key was rejected, i.e. **revoked or rotated without updating this repo's secret**
— a monitoring-config problem, not a platform outage. The tell: the `API` row
(same URL, no auth, expects `401`) stays green, and the live-traffic line on the
`API` row shows real customer requests succeeding. This exact case put the row in
a permanent false `down` from 2026-09-05: the probe key was revoked during a
manual rotation that never ran `gh secret set`.

Confirm and fix:

```bash
# 1. Is the key actually rejected? (401 = bad/revoked key, not an outage)
curl -s -o /dev/null -w '%{http_code}
'   -H "Authorization: Bearer $STATUS_GATEWAY_API_KEY"   https://api.experientiallabs.ai/v1/models

# 2. Mint a fresh key under the SAME status-monitor org. Dashboard: sign in as a
#    platform admin, open the status-monitor org's API keys, create
#    "status-page authenticated probe". Or via the admin API with an xpladmin_ key:
curl -s -X POST https://api.experientiallabs.ai/api/admin/orgs/1a7ba1ee-b847-46b2-a871-e517637ced41/keys   -H "Authorization: Bearer $XPLADMIN_KEY" -H 'Content-Type: application/json'   -d '{"name":"status-page authenticated probe"}' | jq -r .key

# 3. Store it and re-run the checker; the row recovers and the open incident closes.
gh secret set STATUS_GATEWAY_API_KEY --repo experientiallabs/status --body '<new xpl_ key>'
gh workflow run "Uptime CI" --repo experientiallabs/status
```

The status-monitor org (`1a7ba1ee-b847-46b2-a871-e517637ced41`) is unverified and
memberless by design; a `/v1/models` listing returns `200` for any live key of
that org regardless of spend-unlock, so a fresh key is all that is needed.

### Why an incident's minutes can look larger than the outage

Upptime derives each component's per-day downtime and its uptime percentage from
the **open-to-close duration of the `status`-labelled GitHub incident issue**,
not from the individual 5-minute checks. So an issue that stays open after the
service already recovered (a slow auto-close, or one left open by hand) is
counted as continuous downtime — a brief blip whose issue lingered a day reads as
~1,440 minutes down and drags the weekly uptime figure down with it. Keep the
uptime numbers honest by closing recovered incidents promptly: the checker
auto-closes on the next passing run and the stale-incident reconciler catches
the case where that run failed, but verify stale `status` issues after any
monitoring hiccup rather than leaving them open, and annul the ones that were
artifacts (`annulledIssues` plus removing the `status` label).

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
  `assets/status-ui/*` is overlaid at `/ui/` and the whole `vercel/` tree
  (`vercel.json`, `api/cron/*`, `api/feed.js`, `api/notify.js`,
  `api/slack/*`, shared code in `api/_lib/`) at the root; anything under
  `vercel/api/` becomes a serverless function, `_lib` is skipped by Vercel's
  underscore rule. Unit tests for that code: `node --test 'tests/*.test.mjs'`
  (`tests.yml`). Between deploys the page still updates live: uptime numbers
  and incidents are fetched client-side from the GitHub API.
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
| `NOTIFICATION_SLACK`, `NOTIFICATION_SLACK_WEBHOOK_URL` | Optional, set together: Slack alerts from the checker, from traffic-health, and the owner @mention workflow (see Alerts).                                                                                         |
| `NOTIFY_TOKEN`                                         | Optional: shared secret for `POST /api/notify`; the same value goes in the Vercel env (see Subscriptions). Unset = the mention workflow posts the internal webhook directly.                                      |

## Versioning and upkeep

- Monitor workflows are pinned to `upptime/uptime-monitor@v1.43.15`.
- `update-template.yml` and `updates.yml` are Upptime's own self-update lane
  (they track upstream `master` by design and rewrite the generated workflows on
  a daily schedule). To freeze the version entirely, disable those two workflows
  in the Actions UI and bump the pin manually via a config push.
- Response-time history and graphs are committed to this repo by the bot; that
  is expected and is what powers the history on the page.
