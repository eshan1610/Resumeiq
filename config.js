/**
 * ResumeIQ — Frontend Config
 *
 * ─── BEFORE DEPLOYING TO VERCEL ───────────────────────────────────────────
 * 1. Deploy the backend to Render first (see render.yaml)
 * 2. Copy your Render service URL — looks like:
 *      https://resumeiq-api.onrender.com
 * 3. Paste it below as PROD_API_URL
 * 4. Then deploy frontend to Vercel
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ⚠️  This file is committed to git — do NOT put secrets here.
 *     Only put the public backend URL.
 */

(function () {
  const isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  // ─── CHANGE THIS to your Render URL after first deploy ───────────────────
  const PROD_API_URL = 'https://resumeiq-api.onrender.com';
  // ─────────────────────────────────────────────────────────────────────────

  const DEV_API_URL  = 'http://localhost:4000';

  window.RESUMEIQ_CONFIG = {
    API_BASE:    isLocal ? DEV_API_URL : PROD_API_URL,
    IS_DEV:      isLocal,
    VERSION:     '1.0.0',
  };

  if (isLocal) {
    console.info(
      '%c[ResumeIQ] Dev mode — API: ' + DEV_API_URL,
      'color:#818cf8;font-weight:600'
    );
  }
})();
