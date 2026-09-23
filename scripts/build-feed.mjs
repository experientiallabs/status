// Builds assets/status-ui/feed.xml (Atom 1.0) from the SAME merged incident
// record the page renders: the curated assets/status-ui/incidents.json plus
// the checker's live `status`-labelled issues opened after liveIssuesSince,
// minus annulledIssues. The merge and severity rules are not re-implemented
// here: the block between the `@shared-begin mergedIncidents` and
// `@shared-end mergedIncidents` markers in assets/status-ui/uptime-bars.js is
// evaluated verbatim, so the feed cannot drift from the page.
//
// Run by .github/workflows/feed.yml. Zero dependencies; Node 20+.
//
//   node scripts/build-feed.mjs --issues issues.json [--out assets/status-ui/feed.xml]
//     --issues: GitHub issues JSON (state=all, labels=status) saved by the workflow.
//     --now:    ISO timestamp for "ongoing" ends (tests); defaults to now.
//
// Output is deterministic for a given record + issues + now, so the workflow
// commits only when the bytes changed.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..");
export const SITE = "https://status.experientiallabs.ai";
export const FEED_URL = `${SITE}/feed.xml`;
export const FEED_TITLE = "Experiential Labs Status";
const TAG_AUTHORITY = "tag:status.experientiallabs.ai,2026:";
const MAX_ENTRIES = 100;
const COMPONENT_LABELS = { api: "API", web: "Web Dashboard", docs: "Docs", gateway: "Gateway", dashboard: "Dashboard (signed in)" };

// Pulls mergedIncidents out of the browser script. The block uses only Date,
// Set, Array and the record/issues arguments (no DOM), so it evaluates as-is.
export function loadMergedIncidents(source = readFileSync(resolve(ROOT, "assets/status-ui/uptime-bars.js"), "utf8")) {
  const match = source.match(/\/\/ @shared-begin mergedIncidents[^\n]*\n(?:\s*\/\/[^\n]*\n)*([\s\S]*?)\n\s*\/\/ @shared-end mergedIncidents/);
  if (!match) throw new Error("uptime-bars.js: @shared-begin/@shared-end mergedIncidents markers not found");
  // eslint-disable-next-line no-new-func
  return new Function(`${match[1]}\nreturn mergedIncidents;`)();
}

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const iso = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
const hhmm = (value) => new Date(value).toISOString().slice(11, 16);
const day = (value) => new Date(value).toISOString().slice(0, 10);

export function formatDuration(start, end) {
  const minutes = Math.max(1, Math.round((new Date(end) - new Date(start)) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${rest} min` : `${minutes} min`;
}

// Shapes one merged incident into the fields an Atom entry needs.
export function feedEntry(incident, now) {
  const ongoing = Boolean(incident.ongoing);
  const end = ongoing ? now : incident.end;
  const component = COMPONENT_LABELS[incident.component] || incident.component;
  const state = incident.severity === "down" ? "Outage" : "Degraded";
  const window = ongoing
    ? `${day(incident.start)} ${hhmm(incident.start)} UTC – ongoing`
    : day(incident.start) === day(end)
      ? `${day(incident.start)} ${hhmm(incident.start)}–${hhmm(end)} UTC`
      : `${day(incident.start)} ${hhmm(incident.start)} – ${day(end)} ${hhmm(end)} UTC`;
  const duration = formatDuration(incident.start, end);
  return {
    id: `${TAG_AUTHORITY}${incident.id}`,
    title: `${state}: ${component} — ${incident.title}${ongoing ? " (ongoing)" : ""}`,
    link: incident.href ? `${SITE}${incident.href}` : `${SITE}/`,
    published: iso(incident.start),
    updated: iso(end),
    component: incident.component,
    severity: incident.severity,
    ongoing,
    summary: `${component} · ${state} · ${window} · ${duration}${ongoing ? " so far" : ""}`,
    description: incident.description || "",
  };
}

export function renderAtom(entries, { now }) {
  const newest = entries.reduce((max, entry) => (entry.updated > max ? entry.updated : max), entries[0]?.updated || iso(now));
  const body = entries
    .map((entry) => {
      const content = [
        `<p>${escapeXml(entry.summary)}</p>`,
        entry.description ? `<p>${escapeXml(entry.description)}</p>` : "",
        `<p><a href="${escapeXml(entry.link)}">${escapeXml(entry.link)}</a></p>`,
      ]
        .filter(Boolean)
        .join("");
      return [
        "  <entry>",
        `    <id>${escapeXml(entry.id)}</id>`,
        `    <title>${escapeXml(entry.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(entry.link)}"/>`,
        `    <published>${entry.published}</published>`,
        `    <updated>${entry.updated}</updated>`,
        `    <category term="${escapeXml(entry.component)}" label="${escapeXml(COMPONENT_LABELS[entry.component] || entry.component)}"/>`,
        `    <category term="${escapeXml(entry.severity)}"/>`,
        `    <summary>${escapeXml(entry.summary)}</summary>`,
        `    <content type="html">${escapeXml(content)}</content>`,
        "  </entry>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${TAG_AUTHORITY}feed</id>`,
    `  <title>${escapeXml(FEED_TITLE)}</title>`,
    `  <subtitle>Incidents and degradations on the Experiential Labs platform, one entry per incident (UTC).</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${FEED_URL}"/>`,
    `  <link rel="alternate" type="text/html" href="${SITE}/"/>`,
    `  <updated>${newest}</updated>`,
    `  <author><name>Experiential Labs</name><uri>${SITE}/</uri></author>`,
    `  <generator uri="https://github.com/experientiallabs/status">feed.yml</generator>`,
    body,
    "</feed>",
    "",
  ].join("\n");
}

export function buildFeed(record, issues, { now = new Date().toISOString(), mergedIncidents = loadMergedIncidents() } = {}) {
  const nowIso = iso(now);
  // mergedIncidents stamps ongoing issues with `new Date()`; pin it to `now` so
  // a rebuild with identical inputs is byte-identical.
  const RealDate = Date;
  const fixed = new RealDate(nowIso).getTime();
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  let merged;
  try {
    merged = mergedIncidents(record, issues);
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
  }
  const entries = merged
    .map((incident) => feedEntry(incident, nowIso))
    .sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : a.id < b.id ? 1 : -1))
    .slice(0, MAX_ENTRIES);
  return { xml: renderAtom(entries, { now: nowIso }), entries };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const record = JSON.parse(readFileSync(resolve(ROOT, args.record || "assets/status-ui/incidents.json"), "utf8"));
  const issues = args.issues ? JSON.parse(readFileSync(resolve(args.issues), "utf8")) : [];
  const out = resolve(ROOT, args.out || "assets/status-ui/feed.xml");
  const { xml, entries } = buildFeed(record, issues, { now: args.now });
  writeFileSync(out, xml);
  console.log(`feed: ${entries.length} entries -> ${out}`);
  entries.slice(0, 5).forEach((entry) => console.log(`  ${entry.published}  ${entry.title}`));
}
