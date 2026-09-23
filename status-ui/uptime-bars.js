// Statuspage-style enhancements rendered on top of Upptime's generated DOM:
//   1. Per-day 90-day uptime bars under each component row and the uptime
//      percentage in their legend, both derived from ONE source:
//      assets/status-ui/incidents.json (curated, UTC, start/end = when the
//      effect actually started and stopped) merged with the checker's own
//      status-labelled issues opened after incidents.liveIssuesSince (minus
//      incidents.annulledIssues, which are monitoring artifacts). Upptime's own
//      figures derive downtime from how long an incident ISSUE stayed open,
//      which counted a 15-minute blip whose issue lingered a day as ~1,440
//      minutes down (2026-09-05/06); the curated record replaces that.
//      'down' minutes count against uptime and colour a day red at an hour or
//      more; 'degraded' minutes (serving with elevated errors/latency) colour a
//      day yellow and do not reduce the percentage. Days before
//      incidents.monitoringSince render operational.
//   2. A dated "Past Incidents" section covering the last 14 days, including
//      "No incidents reported." rows, from the same merged record: each entry
//      carries the component, the UTC time window, the duration, and a short
//      technical description. Upptime's own past-incidents section (which
//      renders only dates that had incidents) is hidden when this one renders.
//   4. A "Dashboard (signed in)" row under the Web Dashboard row, from
//      assets/status-ui/signed-in-health.json (the signed-in-health workflow:
//      a monitor account renders /overview through the public hostname every
//      5 minutes, including the session-refresh path). The checker has no
//      session, so the 2026-09-22 signed-in-only 502s never reached this page.
//      The row's 90-day bars come from the same merged incident record, keyed
//      on component `dashboard` (the workflow's `status` + `dashboard` issues).
//   3. A "Subscribe to updates" row above Past Incidents (Atom feed, Slack's
//      built-in /feed command, the optional "Add to Slack" button when
//      assets/status-ui/subscribe.json says slackAppEnabled, and the README
//      for anything else) plus the <link rel="alternate"> feed discovery tag.
//      The feed itself (assets/status-ui/feed.xml, built by feed.yml) is
//      rendered from the SAME mergedIncidents function below: the builder
//      loads the block between the @shared markers verbatim, so feed == page.
//
// Loaded from .upptimerc.yml's customHeadHtml; the Deploy-to-Vercel workflow
// copies this file into the served tree at /ui/uptime-bars.js. No secrets, no
// build step, no state: everything is fetched from public artifacts.
(() => {
  const OWNER = "experientiallabs";
  const REPO = "status";
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/HEAD`;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const BAR_DAYS = 90;
  const INCIDENT_DAYS = 14;

  const style = document.createElement("style");
  style.textContent = `
    .ub-wrap { display: block; margin-top: 0.65rem; }
    .ub-strip { display: flex; gap: 2px; }
    .ub-strip span { flex: 1 1 0; height: 34px; border-radius: 1.5px; background: #2fcc66; }
    .ub-strip span.ub-partial { background: #f1c40f; }
    .ub-strip span.ub-down { background: #e74c3c; }
    .ub-legend { display: flex; justify-content: space-between; align-items: center;
      margin-top: 0.4rem; font-size: 0.75rem; color: #9ca3af; }
    .ub-legend b { color: #6b7280; font-weight: 600; }
    /* The metrics sit in their own flex row UNDER the title, cleared past the
       theme's floated status pill: appended inline they ran under the pill on
       the API row at desktop widths ("last 15 min)" through "Operational"). */
    .ub-metrics { display: flex; flex-wrap: wrap; gap: 0.15rem 1.25rem; clear: both;
      margin-top: 0.35rem; padding-right: 0; }
    .ub-metric { display: inline-block; font-size: 0.8rem; color: #6b7280; }
    .ub-metric-value { color: #374151; font-variant-numeric: tabular-nums; }
    .ub-metric-note { color: #9ca3af; }
    .ub-metric-value.ub-metric-degraded { color: #b7791f; font-weight: 600; }
    .ub-metric-value.ub-metric-down { color: #e74c3c; font-weight: 600; }
    /* Live-traffic state overrides the checker's pill and banner. The rules
       must outrank the config sheet's article.up selectors. */
    section.live-status article.ub-degraded { border-left-color: #f1c40f !important; }
    section.live-status article.ub-down { border-left-color: #e74c3c !important; }
    section.live-status article.ub-degraded::after { content: "Degraded (live traffic)" !important; color: #b7791f !important; }
    section.live-status article.ub-down::after { content: "Down (live traffic)" !important; color: #e74c3c !important; }
    main > article.ub-degraded { background: #f1c40f !important; }
    main > article.ub-down { background: #e74c3c !important; }
    main > article.ub-degraded::before { content: "Degraded Performance: live API traffic is failing" !important; color: #1f2937 !important; }
    main > article.ub-down::before { content: "Partial Outage: live API traffic is failing" !important; }
    /* Signed-in dashboard state, same precedence idea; declared after the
       traffic rules so a dashboard outage wins the banner text when both fire. */
    main > article.ub-dash-degraded { background: #f1c40f !important; }
    main > article.ub-dash-down { background: #e74c3c !important; }
    main > article.ub-dash-degraded::before { content: "Degraded Performance: the signed-in dashboard is failing intermittently" !important; color: #1f2937 !important; }
    main > article.ub-dash-down::before { content: "Partial Outage: the signed-in dashboard is not rendering" !important; }
    section.ub-incidents h2 { font-size: 1rem; font-weight: 600; margin-top: 2rem; }
    section.ub-incidents h3 { font-size: 0.9rem; font-weight: 600; color: #1f2937;
      border-bottom: 1px solid #e5e7eb; padding-bottom: 0.4rem; margin-top: 1.4rem; }
    section.ub-incidents p.ub-none { color: #9ca3af; font-size: 0.85rem; margin: 0.5rem 0 0; }
    section.ub-incidents article { margin-top: 0.5rem; }
    section.ub-incidents article .ub-meta { color: #6b7280; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
    section.ub-incidents article .ub-desc { color: #374151; font-size: 0.85rem; margin: 0.35rem 0 0; line-height: 1.45; }
    section.ub-incidents article h4 { margin: 0 0 0.2rem 0; font-size: 0.95rem; }
    section.ub-subscribe h2 { font-size: 1rem; font-weight: 600; margin-top: 2rem; }
    section.ub-subscribe .ub-sub-row { display: flex; flex-wrap: wrap; gap: 0.6rem 1.5rem;
      margin-top: 0.6rem; font-size: 0.85rem; color: #374151; }
    section.ub-subscribe .ub-sub-item { flex: 1 1 220px; min-width: 0; }
    section.ub-subscribe .ub-sub-item b { display: block; color: #1f2937; font-weight: 600; margin-bottom: 0.15rem; }
    section.ub-subscribe .ub-sub-item p { margin: 0; color: #6b7280; line-height: 1.45; }
    section.ub-subscribe code { font-size: 0.8rem; background: #f3f4f6; border-radius: 3px; padding: 0.05rem 0.3rem;
      overflow-wrap: anywhere; }
    section.ub-subscribe a.ub-sub-btn { display: inline-block; margin-top: 0.4rem; padding: 0.3rem 0.7rem;
      border: 1px solid #e5e7eb; border-radius: 4px; color: #1f2937; text-decoration: none; font-weight: 600; font-size: 0.8rem; }
    section.ub-subscribe a.ub-sub-btn:hover { background: #f9fafb; }
  `;
  document.head.appendChild(style);

  // Feed autodiscovery (browsers, feed readers, Slack's /feed command). The
  // Upptime head is generated from .upptimerc.yml, so the tag is injected here.
  const FEED_PATH = "/feed.xml";
  if (!document.querySelector('link[rel="alternate"][type="application/atom+xml"]')) {
    const alternate = document.createElement("link");
    alternate.rel = "alternate";
    alternate.type = "application/atom+xml";
    alternate.title = "Experiential Labs Status";
    alternate.href = FEED_PATH;
    document.head.appendChild(alternate);
  }

  const utcKey = (date) => date.toISOString().slice(0, 10);
  const daysAgo = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  };
  const prettyDate = (key) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const summaryPromise = fetch(`${RAW}/history/summary.json`).then((res) => res.json());
  // Server-side latency from prod telemetry (refreshed by the server-latency
  // workflow, committed to main): rendered instead of Upptime's checker
  // average, which measures a fresh runner's cold DNS+TLS+TTFB, not our
  // servers. Fetched from raw main so updates need no redeploy.
  const latencyPromise = fetch(`${RAW}/assets/status-ui/server-latency.json`)
    .then((res) => (res.ok ? res.json() : { components: {} }))
    .catch(() => ({ components: {} }));
  // Health from REAL customer traffic (gateway ledger, last 15 minutes),
  // refreshed every 5 minutes by the traffic-health workflow. Rendered on the
  // API row next to the synthetic check so a reader sees what customers see.
  const trafficPromise = fetch(`${RAW}/assets/status-ui/traffic-health.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  // Signed-in dashboard check (a monitor account renders /overview through the
  // public hostname, including the session-refresh path), refreshed every 5
  // minutes by the signed-in-health workflow. Rendered as its own row.
  const signedInPromise = fetch(`${RAW}/assets/status-ui/signed-in-health.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const issuesPromise = fetch(
    `${API}/issues?state=all&labels=status&per_page=100`
  ).then((res) => (res.ok ? res.json() : []));
  const EMPTY_RECORD = { monitoringSince: null, liveIssuesSince: null, annulledIssues: [], incidents: [] };
  // Curated incident record (see header). Fetched from raw main so an edit to
  // the record needs no redeploy, like traffic-health.json.
  const incidentsPromise = fetch(`${RAW}/assets/status-ui/incidents.json`)
    .then((res) => (res.ok ? res.json() : EMPTY_RECORD))
    .catch(() => EMPTY_RECORD);

  // Subscription options flag (assets/status-ui/subscribe.json): the "Add to
  // Slack" button renders only when the owner has enabled the Slack app.
  const subscribePromise = fetch(`${RAW}/assets/status-ui/subscribe.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Minutes of [start, end) that fall on each UTC day, as { "YYYY-MM-DD": minutes }.
  function minutesByDay(start, end) {
    const out = {};
    let cursor = new Date(start);
    const stop = new Date(end);
    while (cursor < stop) {
      const dayEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()) + MS_PER_DAY);
      const sliceEnd = dayEnd < stop ? dayEnd : stop;
      const key = utcKey(cursor);
      out[key] = (out[key] || 0) + (sliceEnd - cursor) / 60000;
      cursor = sliceEnd;
    }
    return out;
  }

  // One list of { component, severity, start, end, title, description, href }
  // from the curated record plus the checker's live issues it does not annul.
  // @shared-begin mergedIncidents — scripts/build-feed.mjs evaluates this exact
  // block (no DOM, no closure state), so the Atom feed and the page cannot drift.
  function mergedIncidents(record, issues) {
    const list = (record.incidents || []).map((incident) => ({ ...incident, href: null }));
    const since = record.liveIssuesSince ? new Date(record.liveIssuesSince) : null;
    const annulled = new Set(record.annulledIssues || []);
    (issues || [])
      .filter((issue) => !issue.pull_request && !annulled.has(issue.number))
      .filter((issue) => !since || new Date(issue.created_at) >= since)
      .forEach((issue) => {
        const labels = (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name));
        const component = labels.find((label) => label !== "status") || "api";
        list.push({
          id: `issue-${issue.number}`,
          component,
          // Upptime labels a degraded incident only `status` + slug; the state
          // is in the title ("⚠️ API has degraded performance"). Without this a
          // 24-minute slow window renders as an Outage and counts against uptime.
          severity: labels.includes("degraded") || /degraded performance/i.test(issue.title || "") ? "degraded" : "down",
          start: issue.created_at,
          end: issue.closed_at || new Date().toISOString(),
          ongoing: !issue.closed_at,
          title: issue.title.replace("🛑", "").replace("🟥", "").replace("⚠️", "").trim(),
          description: "Detected by the external checker; see the incident page for the check results.",
          href: `/incident/${issue.number}`,
        });
      });
    return list;
  }
  // @shared-end mergedIncidents

  const COMPONENT_LABELS = { api: "API", web: "Web Dashboard", docs: "Docs", gateway: "Gateway", dashboard: "Dashboard (signed in)" };
  const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);

  function buildStrip(slug, record, incidents) {
    const down = {};
    const degraded = {};
    const titles = {};
    incidents
      .filter((incident) => incident.component === slug)
      .forEach((incident) => {
        const target = incident.severity === "down" ? down : degraded;
        Object.entries(minutesByDay(incident.start, incident.end)).forEach(([key, minutes]) => {
          target[key] = (target[key] || 0) + minutes;
          (titles[key] = titles[key] || []).push(`${incident.title} (${incident.severity})`);
        });
      });
    const since = record.monitoringSince ? new Date(`${record.monitoringSince}T00:00:00Z`) : null;
    const strip = document.createElement("div");
    strip.className = "ub-strip";
    let downMinutes = 0;
    let monitoredMinutes = 0;
    const now = new Date();
    for (let i = BAR_DAYS - 1; i >= 0; i -= 1) {
      const day = daysAgo(i);
      const key = utcKey(day);
      const bar = document.createElement("span");
      const d = Math.round(down[key] || 0);
      const g = Math.round(degraded[key] || 0);
      const monitored = !since || new Date(`${key}T00:00:00Z`) >= since;
      if (monitored) {
        downMinutes += d;
        // Today counts only the minutes elapsed so far.
        const dayStart = new Date(`${key}T00:00:00Z`);
        const elapsed = i === 0 ? (now - dayStart) / 60000 : 24 * 60;
        monitoredMinutes += Math.max(elapsed, d);
      }
      // Red for an hour or more of not serving; yellow for a shorter outage or
      // any degraded period; green otherwise.
      bar.className = d >= 60 ? "ub-down" : d > 0 || g > 0 ? "ub-partial" : "";
      const parts = [];
      if (d) parts.push(`down ${d} min`);
      if (g) parts.push(`degraded ${g} min`);
      bar.title = parts.length
        ? `${prettyDate(key)}: ${parts.join(", ")} — ${[...new Set(titles[key])].join("; ")}`
        : `${prettyDate(key)}: ${monitored ? "no incidents" : "before monitoring began"}`;
      strip.appendChild(bar);
    }
    const uptimePct = monitoredMinutes
      ? (100 * (1 - downMinutes / monitoredMinutes)).toFixed(2)
      : "100.00";
    const legend = document.createElement("div");
    legend.className = "ub-legend";
    legend.innerHTML = `<span>${BAR_DAYS} days ago</span><b title="Share of monitored minutes the component was serving. Degraded periods (yellow) are shown but not counted as downtime.">${uptimePct}&thinsp;% uptime</b><span>Today</span>`;
    const wrap = document.createElement("div");
    wrap.className = "ub-wrap";
    wrap.appendChild(strip);
    wrap.appendChild(legend);
    return wrap;
  }

  const TRAFFIC_SCOPE =
    "Counts only failures the gateway itself owns: internal errors and the " +
    "gateway being unavailable. Exhausted free credits, invalid requests, and " +
    "upstream provider errors are excluded, because those are not platform outages.";

  function trafficMetric(traffic) {
    const figures = traffic && traffic.figures;
    if (!figures || typeof figures.requests !== "number") return null;
    const metric = document.createElement("div");
    metric.className = "ub-metric";
    const verdict = traffic.verdict || "ok";
    const requests = figures.requests.toLocaleString("en-US");
    const errors = Number(figures.gatewayErrorPct || 0).toFixed(1);
    const label = verdict === "down" ? "Down: " : verdict === "degraded" ? "Degraded: " : "";
    const state = `<span class="ub-metric-value${verdict === "ok" ? "" : ` ub-metric-${verdict}`}">${label}${errors}% failed inside the gateway</span>`;
    metric.innerHTML = `Live traffic: ${state} <span class="ub-metric-note">(${requests} requests, last ${traffic.windowMinutes || 15} min)</span>`;
    metric.title = traffic.reason ? `${traffic.reason} ${TRAFFIC_SCOPE}` : TRAFFIC_SCOPE;
    return metric;
  }

  // The checker's uptime figure and pill describe synthetic probes; live
  // traffic can be failing while every probe passes (2026-09-05: 24% of
  // requests failed inside the gateway for 35 minutes with /v1/models green).
  // When live traffic is not ok, the API row and the summary banner say so.
  // The 90-day bars and uptime percentages stay on Upptime's incident data.
  function reflectTrafficState(row, traffic) {
    const verdict = (traffic && traffic.verdict) || "ok";
    const banner = document.querySelector("main > article");
    for (const el of [row, banner]) {
      if (!el) continue;
      el.classList.remove("ub-degraded", "ub-down");
      if (verdict === "ok") continue;
      el.classList.add(verdict === "down" ? "ub-down" : "ub-degraded");
    }
  }

  // The signed-in dashboard row. Upptime renders one article per configured
  // site; this check is not a site (it needs a session, which the checker
  // cannot hold), so its row is built here in the same shape as the generated
  // ones: the sibling row's classes (the generator's scoped class carries the
  // card layout and the pill positioning), an h4 title, a metrics line, and
  // the 90-day strip keyed on component `dashboard`. The pill is the config
  // sheet's own up/down/degraded ::after rule. A record older than STALE_MS
  // (the workflow stopped running) says "check overdue" and claims nothing.
  const DASHBOARD_SLUG = "dashboard";
  const DASHBOARD_ISSUES = `https://github.com/${OWNER}/${REPO}/issues?q=label%3A${DASHBOARD_SLUG}`;
  const SIGNED_IN_STALE_MS = 30 * 60 * 1000;
  const SIGNED_IN_SCOPE =
    "A dedicated monitor account signs in and loads the signed-in landing page through the public " +
    "hostname, then repeats with an expired token so the session refresh writes its chunked cookies. " +
    "Down means the page did not render on two attempts; degraded means one attempt failed or the render was slow.";

  function signedInState(signedIn) {
    if (!signedIn || !signedIn.generatedAt) return "unknown";
    if (Date.now() - new Date(signedIn.generatedAt) > SIGNED_IN_STALE_MS) return "stale";
    return ["ok", "degraded", "down"].includes(signedIn.verdict) ? signedIn.verdict : "unknown";
  }

  function signedInMetric(signedIn, state) {
    const figures = (signedIn && signedIn.figures) || {};
    const metric = document.createElement("div");
    metric.className = "ub-metric";
    const checked = signedIn && signedIn.generatedAt ? `checked ${hhmm(signedIn.generatedAt)} UTC` : "no check recorded";
    if (state === "unknown" || state === "stale" || typeof figures.pageMs !== "number") {
      const text = state === "stale" ? "check overdue" : "check unavailable";
      metric.innerHTML = `Signed-in page: <span class="ub-metric-value">${text}</span> <span class="ub-metric-note">(${checked})</span>`;
    } else {
      const reason = signedIn.reason || "";
      const value =
        state === "ok" ? `rendered in ${Math.round(figures.pageMs)} ms`
        : state === "down" ? "Down: not rendering"
        : /slow/i.test(reason) ? "Degraded: slow render"
        : /refresh/i.test(reason) ? "Degraded: session refresh unverified"
        : "Degraded: intermittent errors";
      const chunks = typeof figures.refreshSetCookieChunks === "number" ? `, ${figures.refreshSetCookieChunks} cookie chunks` : "";
      const refresh = typeof figures.refreshMs === "number" ? `session refresh ${Math.round(figures.refreshMs)} ms${chunks}, ` : "";
      metric.innerHTML = `Signed-in page: <span class="ub-metric-value${state === "ok" ? "" : ` ub-metric-${state}`}">${value}</span> <span class="ub-metric-note">(${refresh}${checked})</span>`;
    }
    metric.title = signedIn && signedIn.reason ? `${signedIn.reason} ${SIGNED_IN_SCOPE}` : SIGNED_IN_SCOPE;
    return metric;
  }

  function renderSignedInRow(signedIn, record, incidents) {
    const rows = [...document.querySelectorAll("section.live-status article")];
    const webRow = rows.find((row) => {
      const link = row.querySelector("h4 a[href*='/history/']");
      return link && link.getAttribute("href").endsWith("/history/web");
    });
    if (!webRow) return;
    const state = signedInState(signedIn);
    let row = document.querySelector("section.live-status article.ub-synthetic");
    if (!row) {
      row = document.createElement("article");
      row.dataset.ubSlug = DASHBOARD_SLUG;
      const title = document.createElement("h4");
      const link = document.createElement("a");
      link.href = DASHBOARD_ISSUES;
      const webLink = webRow.querySelector("h4 a");
      if (webLink && webLink.className) link.className = webLink.className;
      link.textContent = COMPONENT_LABELS[DASHBOARD_SLUG];
      link.title = "Incident history for this check";
      title.appendChild(link);
      row.appendChild(title);
      const metrics = document.createElement("div");
      metrics.className = "ub-metrics";
      metrics.appendChild(signedInMetric(signedIn, state));
      row.appendChild(metrics);
      row.appendChild(buildStrip(DASHBOARD_SLUG, record, incidents));
      webRow.insertAdjacentElement("afterend", row);
    }
    // Reapplied on every pass (idempotent): the state classes drive the pill.
    const base = webRow.className
      .split(/\s+/)
      .filter((cls) => cls && !["up", "down", "degraded"].includes(cls) && !cls.startsWith("ub-"));
    const pill = state === "down" ? "down" : state === "degraded" ? "degraded" : "up";
    row.className = [...base, "ub-synthetic", pill].join(" ");
    const banner = document.querySelector("main > article");
    if (banner) {
      banner.classList.remove("ub-dash-down", "ub-dash-degraded");
      if (state === "down" || state === "degraded") banner.classList.add(`ub-dash-${state}`);
    }
  }

  function renderBars([sites, latency, traffic, record, issues, signedIn]) {
    const incidents = mergedIncidents(record, issues);
    const latencyComponents = (latency && latency.components) || {};
    document.querySelectorAll("section.live-status article").forEach((row) => {
      if (row.querySelector(".ub-strip")) return;
      const link = row.querySelector("h4 a[href*='/history/']");
      if (!link) return;
      const slug = link.getAttribute("href").split("/history/").pop();
      const site = sites.find((entry) => entry.slug === slug);
      if (!site) return;
      const lat = latencyComponents[slug];
      const metrics = document.createElement("div");
      metrics.className = "ub-metrics";
      if (lat && typeof lat.p50Ms === "number") {
        const metric = document.createElement("div");
        metric.className = "ub-metric";
        metric.innerHTML = `${lat.label}: <span class="ub-metric-value">${Math.round(lat.p50Ms)} ms</span> <span class="ub-metric-note">(server-side p50, ${lat.windowDays}d)</span>`;
        metrics.appendChild(metric);
      }
      if (slug === "api") {
        const live = trafficMetric(traffic);
        if (live) metrics.appendChild(live);
      }
      if (metrics.childElementCount) row.appendChild(metrics);
      row.appendChild(buildStrip(slug, record, incidents));
    });
    // Outside the per-row guard on purpose: Svelte rewrites the banner's class
    // attribute when its data settles, which drops any class added earlier, so
    // the live-traffic state is reapplied on every enhance pass (idempotent).
    const apiRow = [...document.querySelectorAll("section.live-status article")].find((row) => {
      const link = row.querySelector("h4 a[href*='/history/']");
      return link && link.getAttribute("href").endsWith("/history/api");
    });
    reflectTrafficState(apiRow || null, traffic);
    renderSignedInRow(signedIn, record, incidents);
  }

  // Upptime's own past-incidents list renders only dates that had incidents;
  // the dated section below supersedes it. Svelte renders that list AFTER its
  // own issues fetch settles, i.e. usually after our first pass, so this runs on
  // every enhance pass (idempotent), not once inside renderIncidents: applied
  // once it left two "Past Incidents" sections on the page (seen 2026-09-13).
  function hideNativeIncidents() {
    document.querySelectorAll("main > section > h2").forEach((heading) => {
      if (heading.textContent.trim().toLowerCase() === "past incidents" && !heading.parentElement.classList.contains("ub-incidents")) {
        heading.parentElement.style.display = "none";
      }
    });
  }

  // "Subscribe to updates": the Atom feed, Slack's built-in RSS app (zero
  // setup), the self-service "Add to Slack" button when the owner enabled the
  // app, and the README for webhooks / the JSON record. Rendered once, above
  // Past Incidents.
  function renderSubscribe(subscribe) {
    if (document.querySelector("section.ub-subscribe")) return;
    const main = document.querySelector("main");
    if (!main) return;
    const feedUrl = `${location.origin}${FEED_PATH}`;
    const section = document.createElement("section");
    section.className = "ub-subscribe";
    const title = document.createElement("h2");
    title.textContent = "Subscribe to updates";
    section.appendChild(title);
    const row = document.createElement("div");
    row.className = "ub-sub-row";

    const feed = document.createElement("div");
    feed.className = "ub-sub-item";
    feed.innerHTML = `<b>RSS / Atom</b><p><a href="${FEED_PATH}">${feedUrl.replace(/^https?:\/\//, "")}</a><br>One entry per incident, updated when an incident opens, changes, or resolves.</p>`;
    row.appendChild(feed);

    const slack = document.createElement("div");
    slack.className = "ub-sub-item";
    slack.innerHTML = `<b>Slack</b><p>In any channel: <code>/feed subscribe ${feedUrl}</code></p>`;
    if (subscribe && subscribe.slackAppEnabled) {
      const button = document.createElement("a");
      button.className = "ub-sub-btn";
      button.href = "/api/slack/install";
      button.textContent = "Add to Slack";
      button.title = "Post incident updates to a channel of your choice";
      slack.appendChild(button);
    }
    row.appendChild(slack);

    const other = document.createElement("div");
    other.className = "ub-sub-item";
    other.innerHTML = `<b>Webhook / other</b><p>The <a href="https://github.com/${OWNER}/${REPO}#subscriptions">README</a> documents the feed and the JSON incident record behind this page.</p>`;
    row.appendChild(other);

    section.appendChild(row);
    const incidents = document.querySelector("section.ub-incidents");
    if (incidents) main.insertBefore(section, incidents);
    else main.appendChild(section);
  }

  function renderIncidents([record, issues]) {
    if (document.querySelector("section.ub-incidents")) return;
    const main = document.querySelector("main");
    if (!main) return;

    const incidents = mergedIncidents(record, issues).sort((a, b) => new Date(a.start) - new Date(b.start));
    const section = document.createElement("section");
    section.className = "ub-incidents";
    const title = document.createElement("h2");
    title.textContent = "Past Incidents";
    section.appendChild(title);

    for (let i = 0; i < INCIDENT_DAYS; i += 1) {
      const key = utcKey(daysAgo(i));
      const heading = document.createElement("h3");
      heading.textContent = prettyDate(key);
      section.appendChild(heading);
      // An incident is listed on the day it started.
      const dayIncidents = incidents.filter((incident) => utcKey(new Date(incident.start)) === key);
      if (!dayIncidents.length) {
        const none = document.createElement("p");
        none.className = "ub-none";
        none.textContent = "No incidents reported.";
        section.appendChild(none);
        continue;
      }
      dayIncidents.forEach((incident) => {
        const article = document.createElement("article");
        article.className = incident.severity === "down" ? "down" : "degraded";
        const name = document.createElement("h4");
        if (incident.href) {
          const link = document.createElement("a");
          link.href = incident.href;
          link.textContent = incident.title;
          name.appendChild(link);
        } else {
          name.textContent = incident.title;
        }
        const meta = document.createElement("div");
        meta.className = "ub-meta";
        const minutes = Math.max(1, Math.round((new Date(incident.end) - new Date(incident.start)) / 60000));
        const component = COMPONENT_LABELS[incident.component] || incident.component;
        const window = incident.ongoing
          ? `${hhmm(incident.start)} UTC – ongoing`
          : `${hhmm(incident.start)}–${hhmm(incident.end)} UTC · ${minutes} min`;
        const state = incident.severity === "down" ? "Outage" : "Degraded";
        meta.textContent = `${component} · ${state} · ${window}`;
        const body = document.createElement("p");
        body.className = "ub-desc";
        body.textContent = incident.description || "";
        article.appendChild(name);
        article.appendChild(meta);
        if (incident.description) article.appendChild(body);
        section.appendChild(article);
      });
    }
    main.appendChild(section);
  }

  function enhance() {
    if (!document.querySelector("section.live-status")) {
      // Not on the index route (component/incident pages): drop the injected
      // incidents section so it cannot linger under another route's content.
      document.querySelectorAll("section.ub-incidents, section.ub-subscribe").forEach((orphan) => orphan.remove());
      return false;
    }
    if (!document.querySelector("section.live-status article")) return false;
    hideNativeIncidents();
    Promise.all([summaryPromise, latencyPromise, trafficPromise, incidentsPromise, issuesPromise, signedInPromise])
      .then(renderBars)
      .catch(() => {});
    Promise.all([incidentsPromise, issuesPromise]).then(renderIncidents).catch(() => {});
    subscribePromise.then(renderSubscribe).catch(() => {});
    return true;
  }

  // The site is a Sapper SPA: navigating into a component/incident page and
  // back re-renders the index client-side, discarding injected nodes. enhance
  // is idempotent (guards on .ub-strip / .ub-incidents), so the observer stays
  // connected for the page's lifetime, and pageshow/popstate cover bfcache
  // restores and history navigation.
  let scheduled = false;
  const scheduleEnhance = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  };
  new MutationObserver(scheduleEnhance).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("pageshow", scheduleEnhance);
  window.addEventListener("popstate", scheduleEnhance);
  enhance();
})();
