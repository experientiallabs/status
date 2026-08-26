# Experiential Labs Status

Public status page for the Experiential Labs platform, served at
**[status.experientiallabs.ai](https://status.experientiallabs.ai)**, powered by
[Upptime](https://upptime.js.org) (MIT).

Checks run every 5 minutes from GitHub Actions and the page is a static site
served by Vercel, so the status page shares **no infrastructure** with the
platform: no Porter cluster, no Supabase, no shared pooler. If the platform is
down, this page stays up and says so.

## What is monitored

| Component           | Check                                                             | Healthy when                                                                                            |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Web Dashboard       | `GET platform.experientiallabs.ai/signin` (light, always-public)  | 200                                                                                                     |
| API                 | `GET api.experientiallabs.ai/v1/models`, unauthenticated          | **401**; the app rejecting the request proves edge + gateway worker + auth are alive, and a 5xx is down |
| Docs                | `GET platform.experientiallabs.ai/docs`                           | 200                                                                                                     |
| Gateway Completions | `POST /v1/chat/completions`, a real 1-token completion            | 200; disabled until a status-org key exists (below)                                                     |

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

## Enabling the gateway completion probe

The deep probe needs a dedicated, minimally funded API key from a status-only
organization (never a customer or house org key: the key sits in this repo's
Actions secrets and is sent from GitHub runners):

1. Create a status org on the platform and mint an `xpl_` key with a small
   credit grant.
2. `gh secret set STATUS_GATEWAY_API_KEY --repo experientiallabs/status`
3. Uncomment the `Gateway Completions` site in `.upptimerc.yml` and merge; Setup
   CI regenerates the workflows on that push.

Rotate the key like any other production credential; it is referenced only as
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
  or more. Days before monitoring began (2026-08-25) come from
  `assets/status-ui/backfill.json`: real pre-monitoring incidents are encoded
  from the operator timeline and prod telemetry with a `src` flag per day
  (`incident` or `telemetry`), and days absent from a component's map render
  operational, the standard convention for new status pages. The favicon is
  the vendored `assets/logo.svg` / `logo-192.png`.
- DNS: Namecheap CNAME record, host `status`, value `cname.vercel-dns.com.`
  (Vercel issues and renews the TLS certificate automatically.)

### Required repository secrets

| Secret          | Why                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GH_PAT`        | The enterprise forces the default `GITHUB_TOKEN` to read-only; without a fine-grained PAT (this repo only; Contents + Issues read/write) Upptime cannot commit history, open incident issues, or push `gh-pages`. |
| `VERCEL_TOKEN`  | Deploys the site; scoped to the `experiential-labs` Vercel team.                                                                                                                                                  |
| `VERCEL_ORG_ID` | Team id written into `.vercel/project.json` at deploy time.                                                                                                                                                       |

## Versioning and upkeep

- Monitor workflows are pinned to `upptime/uptime-monitor@v1.43.15`.
- `update-template.yml` and `updates.yml` are Upptime's own self-update lane
  (they track upstream `master` by design and rewrite the generated workflows on
  a daily schedule). To freeze the version entirely, disable those two workflows
  in the Actions UI and bump the pin manually via a config push.
- Response-time history and graphs are committed to this repo by the bot; that
  is expected and is what powers the history on the page.
