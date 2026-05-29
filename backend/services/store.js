/**
 * In-Memory Store
 *
 * Two stores:
 *   scanSessions  — resume text cached after free scan (15 min TTL)
 *   reportTokens  — one-time tokens issued after payment (30 min TTL)
 *
 * In production, swap this for Redis.
 * Everything is ephemeral — no resume text is ever persisted to disk.
 */

const { v4: uuidv4 } = require('uuid');

// ─── Scan sessions ─────────────────────────────────────────────────────────
// scanId → { resumeText, wordCount, fileType, expiresAt }
const scanSessions = new Map();
const SCAN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function createScanSession({ resumeText, wordCount, fileType }) {
  const scanId = uuidv4();
  scanSessions.set(scanId, {
    resumeText,
    wordCount,
    fileType,
    expiresAt: Date.now() + SCAN_TTL_MS,
  });
  return scanId;
}

function getScanSession(scanId) {
  const session = scanSessions.get(scanId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    scanSessions.delete(scanId);
    return null;
  }
  return session;
}

// ─── Payment tokens ────────────────────────────────────────────────────────
// token → { scanId, used, expiresAt, razorpayOrderId, razorpayPaymentId }
const reportTokens = new Map();
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function createReportToken({ scanId, razorpayOrderId, razorpayPaymentId }) {
  const token = uuidv4();
  reportTokens.set(token, {
    scanId,
    used: false,
    razorpayOrderId,
    razorpayPaymentId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

function validateAndConsumeToken(token) {
  const entry = reportTokens.get(token);
  if (!entry) return { valid: false, reason: 'Token not found' };
  if (entry.used) return { valid: false, reason: 'Token already used' };
  if (Date.now() > entry.expiresAt) {
    reportTokens.delete(token);
    return { valid: false, reason: 'Token expired' };
  }
  // Mark as used (one-time)
  entry.used = true;
  reportTokens.set(token, entry);
  return { valid: true, scanId: entry.scanId };
}

// ─── Periodic cleanup (every 10 min) ──────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of scanSessions) {
    if (now > v.expiresAt) scanSessions.delete(k);
  }
  for (const [k, v] of reportTokens) {
    if (now > v.expiresAt) reportTokens.delete(k);
  }
}, 10 * 60 * 1000);

module.exports = {
  createScanSession,
  getScanSession,
  createReportToken,
  validateAndConsumeToken,
};
