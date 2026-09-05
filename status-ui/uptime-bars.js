// Statuspage-style enhancements rendered on top of Upptime's generated DOM:
//   1. Per-day 90-day uptime bars under each component row, derived from the
//      dailyMinutesDown map Upptime itself computes from incident issues and
//      commits into history/summary.json on every check run. That map is the
//      SINGLE source for both the bars and the legend percentage, the same
//      pipeline behind Upptime's own uptime numbers, so they cannot diverge.
//      Days before monitoring began render operational (owner decision,
//      Aug 2026; pre-monitoring incident history lives in the ops timeline,
//      not on this page).
//   2. A dated "Past Incidents" section covering the last 14 days, including
//      "No incidents reported." rows, from the repo's status-labeled issues
//      (the same source Upptime's uptime numbers use). Upptime's own past-
//      incidents section (which renders only dates that had incidents) is
//      hidden when this one renders.
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
    .ub-metric { display: inline-block; margin-right: 1.25rem; font-size: 0.8rem; color: #6b7280; }
    .ub-metric-value { color: #374151; font-variant-numeric: tabular-nums; }
    .ub-metric-note { color: #9ca3af; }
    .ub-metric-value.ub-metric-degraded { color: #b7791f; font-weight: 600; }
    .ub-metric-value.ub-metric-down { color: #e74c3c; font-weight: 600; }
    section.ub-incidents h2 { font-size: 1rem; font-weight: 600; margin-top: 2rem; }
    section.ub-incidents h3 { font-size: 0.9rem; font-weight: 600; color: #1f2937;
      border-bottom: 1px solid #e5e7eb; padding-bottom: 0.4rem; margin-top: 1.4rem; }
    section.ub-incidents p.ub-none { color: #9ca3af; font-size: 0.85rem; margin: 0.5rem 0 0; }
    section.ub-incidents article { margin-top: 0.5rem; }
    section.ub-incidents article .ub-meta { color: #6b7280; font-size: 0.8rem; }
  `;
  document.head.appendChild(style);

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
  const issuesPromise = fetch(
    `${API}/issues?state=all&labels=status&per_page=100`
  ).then((res) => (res.ok ? res.json() : []));

  function buildStrip(site) {
    const daily = site.dailyMinutesDown || {};
    const strip = document.createElement("div");
    strip.className = "ub-strip";
    let downMinutes = 0;
    for (let i = BAR_DAYS - 1; i >= 0; i -= 1) {
      const key = utcKey(daysAgo(i));
      const bar = document.createElement("span");
      const minutes = daily[key] || 0;
      downMinutes += minutes;
      // Color severity follows downtime share of the day: an hour or more
      // reads as an outage, anything shorter as a partial disruption.
      bar.className = minutes === 0 ? "" : minutes >= 60 ? "ub-down" : "ub-partial";
      bar.title =
        minutes === 0
          ? `${prettyDate(key)}: no downtime`
          : `${prettyDate(key)}: down ${minutes} min`;
      strip.appendChild(bar);
    }
    const uptimePct = (100 * (1 - downMinutes / (BAR_DAYS * 24 * 60))).toFixed(2);
    const legend = document.createElement("div");
    legend.className = "ub-legend";
    legend.innerHTML = `<span>${BAR_DAYS} days ago</span><b>${uptimePct}&thinsp;% uptime</b><span>Today</span>`;
    const wrap = document.createElement("div");
    wrap.className = "ub-wrap";
    wrap.appendChild(strip);
    wrap.appendChild(legend);
    return wrap;
  }

  function trafficMetric(traffic) {
    const figures = traffic && traffic.figures;
    if (!figures || typeof figures.requests !== "number") return null;
    const metric = document.createElement("div");
    metric.className = "ub-metric";
    const verdict = traffic.verdict || "ok";
    const requests = figures.requests.toLocaleString("en-US");
    const errors = Number(figures.gatewayErrorPct || 0).toFixed(1);
    const state =
      verdict === "ok"
        ? `<span class="ub-metric-value">${errors}% gateway errors</span>`
        : `<span class="ub-metric-value ub-metric-${verdict}">${verdict === "down" ? "Down" : "Degraded"}, ${errors}% gateway errors</span>`;
    metric.innerHTML = `Live traffic: ${state} <span class="ub-metric-note">(${requests} requests, last ${traffic.windowMinutes || 15} min)</span>`;
    if (traffic.reason) metric.title = traffic.reason;
    return metric;
  }

  function renderBars([sites, latency, traffic]) {
    const latencyComponents = (latency && latency.components) || {};
    document.querySelectorAll("section.live-status article").forEach((row) => {
      if (row.querySelector(".ub-strip")) return;
      const link = row.querySelector("h4 a[href*='/history/']");
      if (!link) return;
      const slug = link.getAttribute("href").split("/history/").pop();
      const site = sites.find((entry) => entry.slug === slug);
      if (!site) return;
      const lat = latencyComponents[slug];
      if (lat && typeof lat.p50Ms === "number") {
        const metric = document.createElement("div");
        metric.className = "ub-metric";
        metric.innerHTML = `${lat.label}: <span class="ub-metric-value">${Math.round(lat.p50Ms)} ms</span> <span class="ub-metric-note">(server-side p50, ${lat.windowDays}d)</span>`;
        row.appendChild(metric);
      }
      if (slug === "api") {
        const live = trafficMetric(traffic);
        if (live) row.appendChild(live);
      }
      row.appendChild(buildStrip(site));
    });
  }

  function renderIncidents(issues) {
    if (document.querySelector("section.ub-incidents")) return;
    const main = document.querySelector("main");
    if (!main) return;
    // Upptime's own past-incidents list renders only dates that had
    // incidents; this dated section supersedes it.
    document.querySelectorAll("main > section > h2").forEach((heading) => {
      if (heading.textContent.trim().toLowerCase() === "past incidents") {
        heading.parentElement.style.display = "none";
      }
    });

    const incidents = issues.filter((issue) => !issue.pull_request);
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
      const dayIncidents = incidents.filter(
        (issue) => utcKey(new Date(issue.created_at)) === key
      );
      if (!dayIncidents.length) {
        const none = document.createElement("p");
        none.className = "ub-none";
        none.textContent = "No incidents reported.";
        section.appendChild(none);
        continue;
      }
      dayIncidents.forEach((issue) => {
        const article = document.createElement("article");
        article.className = "down";
        const name = document.createElement("h4");
        const link = document.createElement("a");
        link.href = `/incident/${issue.number}`;
        link.textContent = issue.title.replace("🛑", "").replace("⚠️", "").trim();
        name.appendChild(link);
        const meta = document.createElement("div");
        meta.className = "ub-meta";
        if (issue.closed_at) {
          const minutes = Math.max(
            1,
            Math.round((new Date(issue.closed_at) - new Date(issue.created_at)) / 60000)
          );
          meta.textContent = `Resolved after ${minutes} min`;
        } else {
          meta.textContent = "Ongoing";
        }
        article.appendChild(name);
        article.appendChild(meta);
        section.appendChild(article);
      });
    }
    main.appendChild(section);
  }

  function enhance() {
    if (!document.querySelector("section.live-status")) {
      // Not on the index route (component/incident pages): drop the injected
      // incidents section so it cannot linger under another route's content.
      const orphan = document.querySelector("section.ub-incidents");
      if (orphan) orphan.remove();
      return false;
    }
    if (!document.querySelector("section.live-status article")) return false;
    Promise.all([summaryPromise, latencyPromise, trafficPromise]).then(renderBars).catch(() => {});
    issuesPromise.then(renderIncidents).catch(() => {});
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
