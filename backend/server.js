/**
 * ResumeIQ Backend Server
 * Express + Claude API — resume ATS analysis
 *
 * Start: node server.js
 * Dev:   nodemon server.js
 */

require('dotenv').config({ override: true }); // override: true ensures .env values always win over shell env

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const analyzeRouter = require('./routes/analyze');
const paymentRouter = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Security headers ──────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ─── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:3456')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Rate limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),  // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX || '30'),                  // 30 reqs per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a few minutes and try again.',
  },
  // Free scan gets a stricter limit
  skip: (req) => req.path.includes('/health'),
});

app.use('/api/', limiter);

// ─── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/analyze', analyzeRouter);
app.use('/api/payment', paymentRouter);

// Root health check
app.get('/', (req, res) => {
  res.json({
    service: 'ResumeIQ API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      freeScane: 'POST /api/analyze/free',
      fullReport: 'POST /api/analyze/full',
      health: 'GET /api/analyze/health',
    },
  });
});

// ─── 404 handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Unhandled error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   ResumeIQ API — ready            ║
  ║   http://localhost:${PORT}           ║
  ║                                   ║
  ║   POST /api/analyze/free          ║
  ║   POST /api/analyze/full          ║
  ║   GET  /api/analyze/health        ║
  ╚═══════════════════════════════════╝
  `);

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('xxxx')) {
    console.warn('\n⚠️  WARNING: ANTHROPIC_API_KEY is not set in .env');
    console.warn('   Get your key at https://console.anthropic.com\n');
  }
});

module.exports = app;
