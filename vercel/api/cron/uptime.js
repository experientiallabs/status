// Vercel Cron target (every 5 minutes): trigger Upptime's checker workflow.
import { dispatch } from "./_dispatch.js";

export default function handler(req, res) {
  return dispatch(req, res, "uptime");
}
