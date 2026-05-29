/**
 * Payment routes — Razorpay integration
 *
 * POST /api/payment/create-order   — creates a Razorpay order for ₹499
 * POST /api/payment/verify         — verifies signature, issues report token
 */

const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { getScanSession, createReportToken } = require('../services/store');

const router = express.Router();

const PRICE_PAISE = 49900; // ₹499 in paise (Razorpay uses paise)

// Lazily initialise Razorpay so the server still boots without keys (demo mode)
function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay keys not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ─── POST /api/payment/create-order ──────────────────────────────────────
router.post('/create-order', async (req, res) => {
  const { scanId } = req.body;

  if (!scanId) {
    return res.status(400).json({ error: 'scanId is required' });
  }

  // Verify the scan session exists and hasn't expired
  const session = getScanSession(scanId);
  if (!session) {
    return res.status(404).json({
      error: 'Scan session expired or not found. Please re-upload your resume.',
    });
  }

  try {
    const razorpay = getRazorpay();

    const order = await razorpay.orders.create({
      amount: PRICE_PAISE,
      currency: 'INR',
      receipt: `riq_${scanId.slice(0, 8)}`,
      notes: { scanId, product: 'ResumeIQ Full Report' },
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[create-order error]', err.message);

    // Demo mode — return a fake order if Razorpay not configured
    if (err.message.includes('not configured')) {
      return res.json({
        success: true,
        demo: true,
        orderId: `order_DEMO_${Date.now()}`,
        amount: PRICE_PAISE,
        currency: 'INR',
        keyId: 'rzp_test_demo',
        message: 'Demo mode — Razorpay keys not set. Add keys to .env to enable real payments.',
      });
    }

    return res.status(500).json({ error: 'Could not create payment order. Please try again.' });
  }
});

// ─── POST /api/payment/verify ─────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, scanId, demo } = req.body;

  if (!scanId) {
    return res.status(400).json({ error: 'scanId is required' });
  }

  // Verify scan session still valid
  const session = getScanSession(scanId);
  if (!session) {
    return res.status(404).json({
      error: 'Scan session expired. Please re-upload your resume and pay again.',
    });
  }

  // Demo mode bypass (no real payment)
  if (demo || !process.env.RAZORPAY_KEY_SECRET) {
    const reportToken = createReportToken({
      scanId,
      razorpayOrderId: razorpay_order_id || 'demo',
      razorpayPaymentId: razorpay_payment_id || 'demo',
    });
    return res.json({ success: true, reportToken });
  }

  // Verify Razorpay signature
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment fields' });
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    console.warn('[verify] Invalid signature for order', razorpay_order_id);
    return res.status(400).json({ error: 'Payment verification failed. Contact support.' });
  }

  // Signature valid — issue one-time report token
  const reportToken = createReportToken({
    scanId,
    razorpayOrderId: razorpay_order_id,
    razorpayPaymentId: razorpay_payment_id,
  });

  return res.json({ success: true, reportToken });
});

module.exports = router;
