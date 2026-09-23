// Vercel Cron target (every 5 minutes, offset by three): trigger the
// signed-in dashboard check after the checker and the traffic read committed.
import { dispatch } from "./_dispatch.js";

export default function handler(req, res) {
  return dispatch(req, res, "signed-in-health");
}
