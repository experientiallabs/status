// Small helpers shared by the Vercel functions (plain Node request/response).
export function readJsonBody(req, { limit = 64 * 1024 } = {}) {
  if (req.body !== undefined) {
    // Vercel parses JSON bodies when content-type is application/json.
    if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

// Constant-time comparison for shared secrets.
export async function tokenMatches(presented, expected) {
  if (!presented || !expected) return false;
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(String(presented));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearer(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : "";
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Minimal page in the status page's look (same font stack and colours as
// .upptimerc.yml's css). `body` is already-escaped HTML.
export function htmlPage(res, status, title, body) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Experiential Labs Status</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2937;background:#fff;margin:0;padding:3rem 1.25rem}
main{max-width:560px;margin:0 auto}h1{font-size:1.25rem;font-weight:600}p{color:#374151;line-height:1.5}a{color:#1f2937}code{background:#f3f4f6;border-radius:3px;padding:.05rem .3rem}
.ok{border-left:4px solid #2fcc66;padding-left:1rem}.bad{border-left:4px solid #e74c3c;padding-left:1rem}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}<p><a href="/">← Back to the status page</a></p></main></body></html>`);
}

export { escapeHtml };
