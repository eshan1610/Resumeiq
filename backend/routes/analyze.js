/**
 * /api/analyze route
 *
 * POST /api/analyze/free   — free basic scan (haiku). Stores session, returns scanId.
 * POST /api/analyze/full   — paid full report (sonnet). Requires valid reportToken.
 * GET  /api/analyze/health — health check
 */

const express = require('express');
const multer = require('multer');
const { parseResume } = require('../services/parser');
const { freeScan, fullAnalysis } = require('../services/ai');
const { createScanSession, getScanSession, validateAndConsumeToken } = require('../services/store');

const router = express.Router();

// ─── Multer — memory storage only ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype) || /\.(pdf|doc|docx)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are supported'), false);
    }
  },
});

function uploadAndParse(req, res, next) {
  upload.single('resume')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    try {
      req.parsed = await parseResume(req.file.buffer, req.file.mimetype);
      next();
    } catch (parseErr) {
      return res.status(422).json({ error: parseErr.message });
    }
  });
}

// ─── POST /api/analyze/free ────────────────────────────────────────────────
router.post('/free', uploadAndParse, async (req, res) => {
  const { text, wordCount, fileType } = req.parsed;

  try {
    const result = await freeScan(text);

    // Cache resume text in session store (15 min TTL) so full report doesn't need re-upload
    const scanId = createScanSession({ resumeText: text, wordCount, fileType });

    return res.json({
      success: true,
      tier: 'free',
      fileType,
      wordCount,
      scanId,           // frontend uses this to create payment order
      analysis: result,
    });
  } catch (aiErr) {
    console.error('[freeScan error]', aiErr.message);
    return res.status(500).json({
      error: 'Analysis failed. Please try again.',
      detail: process.env.NODE_ENV === 'development' ? aiErr.message : undefined,
    });
  }
});

// ─── POST /api/analyze/full ────────────────────────────────────────────────
// Requires: { reportToken } in request body (multipart or JSON)
router.post('/full', async (req, res) => {
  const reportToken = req.body?.reportToken || req.query?.reportToken;

  if (!reportToken) {
    return res.status(401).json({ error: 'reportToken is required. Complete payment first.' });
  }

  // Validate and consume (one-time use)
  const { valid, reason, scanId } = validateAndConsumeToken(reportToken);
  if (!valid) {
    return res.status(401).json({ error: `Invalid token: ${reason}` });
  }

  // Retrieve cached resume text
  const session = getScanSession(scanId);
  if (!session) {
    return res.status(404).json({
      error: 'Resume session expired. Please re-upload your resume.',
    });
  }

  try {
    const result = await fullAnalysis(session.resumeText);

    // Augment meta with parser data
    if (result.meta) {
      result.meta.wordCount = session.wordCount;
    }

    return res.json({
      success: true,
      tier: 'full',
      fileType: session.fileType,
      wordCount: session.wordCount,
      analysis: result,
    });
  } catch (aiErr) {
    console.error('[fullAnalysis error]', aiErr.message);
    return res.status(500).json({
      error: 'Analysis failed. Please try again.',
      detail: process.env.NODE_ENV === 'development' ? aiErr.message : undefined,
    });
  }
});

// ─── GET /api/analyze/health ───────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    razorpayConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  });
});

module.exports = router;
