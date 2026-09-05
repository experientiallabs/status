// Vercel Cron target (every 5 minutes, offset by two): trigger the live
// traffic-health workflow after the checker has committed its run.
import { dispatch } from "./_dispatch.js";

export default function handler(req, res) {
  return dispatch(req, res, "traffic-health");
}
