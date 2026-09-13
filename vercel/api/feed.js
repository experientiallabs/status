// Serves the Atom feed at /feed.xml (vercel.json rewrites /feed.xml here and
// redirects /feed). The XML is committed to main by feed.yml and read from raw
// GitHub like every other status-ui artifact, so a rebuild needs no redeploy;
// raw GitHub serves it as text/plain, hence this proxy sets the Atom
// content-type and a 60 s edge cache.
const SOURCE = "https://raw.githubusercontent.com/experientiallabs/status/main/assets/status-ui/feed.xml";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    res.status(405).end();
    return;
  }
  let upstream;
  try {
    upstream = await fetch(SOURCE, { headers: { "user-agent": "experientiallabs-status-feed" } });
  } catch (error) {
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.status(503).end(`feed temporarily unavailable: ${error && error.message}`);
    return;
  }
  if (!upstream.ok) {
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.status(upstream.status === 404 ? 404 : 503).end(upstream.status === 404 ? "feed not built yet" : `feed source returned HTTP ${upstream.status}`);
    return;
  }
  const xml = await upstream.text();
  res.setHeader("content-type", "application/atom+xml; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("access-control-allow-origin", "*");
  res.status(200).end(req.method === "HEAD" ? undefined : xml);
}
