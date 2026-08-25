# Experiential Labs Status

Public status page for the Experiential Labs platform, served at
**[status.experientiallabs.ai](https://status.experientiallabs.ai)**, powered by
[Upptime](https://upptime.js.org) (MIT).

Checks run every 5 minutes from GitHub Actions and the page is a static site on
GitHub Pages, so the status page shares **no infrastructure** with the platform:
no Porter cluster, no Supabase, no shared pooler. If the platform is down, this
page stays up and says so.

## What is monitored

| Component | Check | Healthy when |
|---|---|---|
| Web Dashboard | `GET platform.experientiallabs.ai` (follows the 307 to `/models`) | 200 |
| API | `GET api.experientiallabs.ai/v1/models`, unauthenticated | **401** — the app rejecting the request proves edge + gateway worker + auth are alive; a 5xx is down |
| Docs | `GET platform.experientiallabs.ai/docs` | 200 |
| Gateway Completions | `POST /v1/chat/completions`, a real 1-token completion | 200 — disabled until a status-org key exists (below) |

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
organization (never a customer or house org key — the key sits in this repo's
Actions secrets and is sent from GitHub runners):

1. Create a status org on the platform and mint an `xpl_` key with a small
   credit grant.
2. `gh secret set STATUS_GATEWAY_API_KEY --repo experientiallabs/status`
3. Uncomment the `Gateway Completions` site in `.upptimerc.yml` and merge; Setup
   CI regenerates the workflows on that push.

Rotate the key like any other production credential; it is referenced only as
`$STATUS_GATEWAY_API_KEY` in config and never appears in the repo, the page, or
committed history.

## One-time activation (after the initial PR merges)

1. **Required:** add a `GH_PAT` repository secret. The enterprise policy forces
   the default `GITHUB_TOKEN` to read-only, so without a PAT every workflow
   fails: Upptime cannot commit history, open incident issues, or push the
   `gh-pages` branch. Create a **fine-grained PAT scoped to only this repo**
   with Contents and Issues read/write (optionally Actions read/write so Setup
   CI can dispatch graph generation immediately; graphs also run on a daily
   schedule without it), then:

   ```bash
   gh secret set GH_PAT --repo experientiallabs/status
   ```

2. Merging a change to `.upptimerc.yml` triggers **Setup CI**, which runs the
   first checks and dispatches **Static Site CI** to build the page onto the
   `gh-pages` branch. (Re-run it from the Actions tab if it ran before the
   secret existed.)
3. Enable GitHub Pages from `gh-pages` (the CNAME file is generated from
   `status-website.cname`):

   ```bash
   gh api -X POST repos/experientiallabs/status/pages \
     -f build_type=legacy -f "source[branch]=gh-pages" -f "source[path]=/"
   ```

4. Add the DNS record in Namecheap: CNAME host `status` →
   `experientiallabs.github.io.`
5. Once the certificate is issued, enforce HTTPS:

   ```bash
   gh api -X PUT repos/experientiallabs/status/pages -f https_enforced=true
   ```


## Versioning and upkeep

- Monitor workflows are pinned to `upptime/uptime-monitor@v1.43.15`.
- `update-template.yml` and `updates.yml` are Upptime's own self-update lane
  (they track upstream `master` by design and rewrite the generated workflows on
  a daily schedule). To freeze the version entirely, disable those two workflows
  in the Actions UI and bump the pin manually via a config push.
- Response-time history and graphs are committed to this repo by the bot; that
  is expected and is what powers the history on the page.
