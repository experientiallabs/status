import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFeed, feedEntry, formatDuration, loadMergedIncidents, ROOT } from "../scripts/build-feed.mjs";

const NOW = "2026-09-13T15:00:00Z";
const record = {
  monitoringSince: "2026-08-25",
  liveIssuesSince: "2026-09-07T00:00:00Z",
  annulledIssues: [13],
  incidents: [
    { id: "2026-09-11-a", component: "api", severity: "down", start: "2026-09-11T22:37:00Z", end: "2026-09-11T22:55:00Z", title: "Gateway unavailable", description: "503 for 16 minutes." },
    { id: "2026-09-12-b", component: "web", severity: "degraded", start: "2026-09-12T06:50:00Z", end: "2026-09-12T10:50:00Z", title: "Slow pages", description: "Index missing." },
  ],
};
const issue = (number, title, created, closed, labels = ["status", "api"]) => ({
  number,
  title,
  created_at: created,
  closed_at: closed,
  labels: labels.map((name) => ({ name })),
});
const issues = [
  issue(9, "⚠️ API has degraded performance", "2026-09-12T09:16:23Z", "2026-09-12T09:40:16Z"),
  issue(13, "⚠️ API has degraded performance", "2026-09-12T18:44:07Z", "2026-09-13T12:11:00Z"), // annulled
  issue(20, "🟥 Docs is down", "2026-09-13T14:30:00Z", null, ["status", "docs"]), // ongoing
  issue(3, "🟥 API is down", "2026-09-01T00:00:00Z", "2026-09-01T00:10:00Z"), // before liveIssuesSince
  { ...issue(21, "PR not an issue", "2026-09-13T00:00:00Z", null), pull_request: {} },
];

test("mergedIncidents is loaded verbatim from uptime-bars.js", () => {
  const source = readFileSync(resolve(ROOT, "assets/status-ui/uptime-bars.js"), "utf8");
  const fn = loadMergedIncidents(source);
  assert.equal(typeof fn, "function");
  const merged = fn(record, issues);
  const ids = merged.map((i) => i.id).sort();
  assert.deepEqual(ids, ["2026-09-11-a", "2026-09-12-b", "issue-20", "issue-9"]);
  assert.equal(merged.find((i) => i.id === "issue-9").severity, "degraded", "title-based degraded detection");
  assert.equal(merged.find((i) => i.id === "issue-20").severity, "down");
  assert.equal(merged.find((i) => i.id === "issue-20").ongoing, true);
  assert.equal(merged.find((i) => i.id === "issue-20").component, "docs");
});

test("loadMergedIncidents fails loudly when the markers are gone", () => {
  assert.throws(() => loadMergedIncidents("function mergedIncidents() {}"), /markers not found/);
});

test("buildFeed renders one entry per merged incident, newest first, deterministic", () => {
  const { xml, entries } = buildFeed(record, issues, { now: NOW });
  assert.deepEqual(
    entries.map((e) => e.id),
    [
      "tag:status.experientiallabs.ai,2026:issue-20",
      "tag:status.experientiallabs.ai,2026:issue-9",
      "tag:status.experientiallabs.ai,2026:2026-09-12-b",
      "tag:status.experientiallabs.ai,2026:2026-09-11-a",
    ]
  );
  const ongoing = entries[0];
  assert.match(ongoing.title, /^Outage: Docs — Docs is down \(ongoing\)$/);
  assert.equal(ongoing.updated, NOW, "ongoing entries update to now");
  assert.equal(ongoing.link, "https://status.experientiallabs.ai/incident/20");
  assert.match(ongoing.summary, /ongoing · 30 min so far/);
  assert.equal(entries[3].link, "https://status.experientiallabs.ai/");
  assert.equal(entries[3].updated, "2026-09-11T22:55:00Z");
  assert.match(xml, /<updated>2026-09-13T15:00:00Z<\/updated>\n  <author>/, "feed updated = newest entry");
  assert.match(xml, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(xml, /<category term="degraded"\/>/);
  assert.ok(!xml.includes("issue-13"), "annulled issue excluded");
  assert.ok(!xml.includes("issue-3"), "issue before liveIssuesSince excluded");
  assert.ok(!xml.includes("issue-21"), "pull requests excluded");
  assert.equal(buildFeed(record, issues, { now: NOW }).xml, xml, "byte-identical on rebuild");
  assert.equal((xml.match(/<entry>/g) || []).length, 4);
});

test("XML special characters are escaped", () => {
  const rec = { incidents: [{ id: "x", component: "api", severity: "down", start: "2026-09-01T00:00:00Z", end: "2026-09-01T00:05:00Z", title: "A <b> & \"c\"", description: "x < y" }] };
  const { xml } = buildFeed(rec, [], { now: NOW });
  assert.match(xml, /<title>Outage: API — A &lt;b&gt; &amp; &quot;c&quot;<\/title>/);
  assert.ok(!/<title>[^<]*<b>/.test(xml));
});

test("feedEntry windows and durations", () => {
  assert.equal(formatDuration("2026-09-12T18:44:07Z", "2026-09-13T12:11:00Z"), "17 h 27 min");
  assert.equal(formatDuration("2026-09-12T09:16:23Z", "2026-09-12T09:40:16Z"), "24 min");
  const e = feedEntry({ id: "m", component: "api", severity: "degraded", start: "2026-09-12T23:50:00Z", end: "2026-09-13T00:20:00Z", title: "t" }, NOW);
  assert.match(e.summary, /2026-09-12 23:50 – 2026-09-13 00:20 UTC · 30 min/);
});
