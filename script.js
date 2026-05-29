// ============================================
// CONFIG — loaded from config.js
// ============================================
const API_BASE = window.RESUMEIQ_CONFIG?.API_BASE || 'http://localhost:4000';
const IS_DEV   = window.RESUMEIQ_CONFIG?.IS_DEV   ?? true;

// ─── Render free tier cold-start handler ─────────────────────────────────
// Free Render services sleep after 15 min idle — first request takes ~30s.
// We ping /health on page load so it's warm when the user hits "Scan".
(function warmUpBackend() {
  fetch(`${API_BASE}/api/analyze/health`, { method: 'GET' })
    .then(r => r.json())
    .then(d => { if (IS_DEV) console.info('[ResumeIQ] Backend warm ✓', d.status); })
    .catch(() => { if (IS_DEV) console.warn('[ResumeIQ] Backend cold or offline'); });
})();

// ============================================
// NAVBAR SCROLL
// ============================================
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// ============================================
// HAMBURGER MENU
// ============================================
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
hamburger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
mobileMenu.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => mobileMenu.classList.remove('open'))
);

// ============================================
// SCROLL REVEAL
// ============================================
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('visible'), i * 80);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ============================================
// COUNTER ANIMATION
// ============================================
function animateCounter(el) {
  const target = parseInt(el.dataset.target);
  const duration = 1800;
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.round((1 - Math.pow(1 - progress, 3)) * target);
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('.stat-num').forEach(el => counterObserver.observe(el));

// ============================================
// HERO RING ANIMATION
// ============================================
const ringProgress = document.querySelector('.ring-progress');
if (ringProgress) {
  const ringObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      setTimeout(() => { ringProgress.style.strokeDashoffset = '200'; }, 300);
      ringObserver.disconnect();
    }
  }, { threshold: 0.5 });
  const ringEl = document.querySelector('.mockup-score-ring');
  if (ringEl) ringObserver.observe(ringEl);
}

// ============================================
// FAQ ACCORDION
// ============================================
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const answer = item.querySelector('.faq-answer');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(o => {
    o.classList.remove('open');
    o.querySelector('.faq-answer').classList.remove('open');
  });
  if (!isOpen) { item.classList.add('open'); answer.classList.add('open'); }
}

// ============================================
// DRAG & DROP UPLOAD
// ============================================
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

if (dropZone) {
  ['dragenter', 'dragover'].forEach(e =>
    dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.add('dragging'); })
  );
  ['dragleave', 'drop'].forEach(e =>
    dropZone.addEventListener(e, ev => { ev.preventDefault(); dropZone.classList.remove('dragging'); })
  );
  dropZone.addEventListener('drop', ev => {
    if (ev.dataTransfer.files.length) handleFile(ev.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });
}

// ============================================
// STATE
// ============================================
let currentScanId = null;   // set after free scan
let currentFile   = null;   // original file (for display name)

// ============================================
// FILE VALIDATION + FREE SCAN TRIGGER
// ============================================
function handleFile(file) {
  const validTypes = [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (!validTypes.includes(file.type) && !/\.(pdf|doc|docx)$/i.test(file.name)) {
    showToast('Please upload a PDF, DOC, or DOCX file.', 'error'); return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('File too large. Max 5MB.', 'error'); return;
  }
  currentFile = file;
  runFreeScan(file);
}

// ============================================
// FREE SCAN — calls real API
// ============================================
async function runFreeScan(file) {
  const dz = document.getElementById('drop-zone');
  const steps = [
    'Parsing document…', 'Checking ATS compatibility…',
    'Scanning keywords…', 'Scoring impact language…', 'Generating report…',
  ];
  let stepIdx = 0;

  dz.innerHTML = `
    <div class="analyzing">
      <div class="analyze-spinner"></div>
      <p>Analyzing <strong>${escHtml(file.name)}</strong>…</p>
      <span id="step-label">${steps[0]}</span>
      ${!IS_DEV ? '<span class="cold-start-note">First scan may take ~30s to wake the server</span>' : ''}
    </div>`;
  dz.style.pointerEvents = 'none';

  const stepInterval = setInterval(() => {
    stepIdx = (stepIdx + 1) % steps.length;
    const el = document.getElementById('step-label');
    if (el) el.textContent = steps[stepIdx];
  }, 1100);

  try {
    const form = new FormData();
    form.append('resume', file);

    const res  = await fetch(`${API_BASE}/api/analyze/free`, { method: 'POST', body: form });
    const data = await res.json();
    clearInterval(stepInterval);

    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    currentScanId = data.scanId;
    showFreeResult(data);
  } catch (err) {
    clearInterval(stepInterval);
    if (err.message.toLowerCase().includes('fetch') || err.message.includes('Failed')) {
      showDemoFreeResult(file.name);
    } else {
      dz.style.pointerEvents = '';
      resetDropZone();
      showToast(err.message || 'Analysis failed. Please try again.', 'error');
    }
  }
}

// ============================================
// SHOW FREE SCAN RESULT
// ============================================
function showFreeResult(data) {
  const dz    = document.getElementById('drop-zone');
  const a     = data.analysis;
  const score = a.overallScore ?? 0;
  const color = scoreColor(score);

  const issuesHtml = (a.criticalIssues || []).slice(0, 3)
    .map(i => `<li>⚠ ${escHtml(i)}</li>`).join('');

  const catHtml = buildMiniCategories(a.categories);

  dz.style.pointerEvents = '';
  dz.innerHTML = `
    <div class="result-display">
      <div class="result-score-row">
        <div class="result-score" style="color:${color}">${score}</div>
        <div class="result-score-meta">
          <div class="result-grade" style="color:${color}">${a.grade || ''}</div>
          <div class="result-callback">${escHtml(a.estimatedCallbackRate || '')}</div>
        </div>
      </div>
      <div class="result-label">Your ATS Score</div>
      <p class="result-msg">${escHtml(a.summary || '')}</p>
      ${catHtml}
      ${issuesHtml ? `
        <div class="result-issues">
          <p class="result-section-title">Top Issues (3 of ${(a.criticalIssues||[]).length})</p>
          <ul class="result-list bad">${issuesHtml}</ul>
        </div>` : ''}
      <p class="result-upgrade-note">
        Full report includes all ${(a.criticalIssues||[]).length} issues, line-by-line fix plan,
        keyword list &amp; AI rewrite tips
      </p>
      <button class="btn-primary result-pay-btn" onclick="startPayment()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
        Get Full Report — ₹499
      </button>
      <button class="btn-retry" onclick="resetDropZone()">↺ Scan a different resume</button>
    </div>`;
  showToast('Free scan complete!', 'success');
}

function buildMiniCategories(cats) {
  if (!cats) return '';
  const entries = Object.values(cats).slice(0, 4);
  const bars = entries.map(c => {
    const sc    = c.score ?? 0;
    const col   = sc < 40 ? '#ef4444' : sc < 65 ? '#f59e0b' : '#22c55e';
    return `
      <div class="mini-cat-row">
        <span>${escHtml(c.label || '')}</span>
        <div class="mini-bar-track">
          <div class="mini-bar-fill" style="width:${sc}%;background:${col}"></div>
        </div>
        <span class="mini-cat-score" style="color:${col}">${sc}</span>
      </div>`;
  }).join('');
  return `<div class="mini-categories">${bars}</div>`;
}

// ============================================
// DEMO MODE (backend offline)
// ============================================
function showDemoFreeResult(filename) {
  currentScanId = 'DEMO';
  const score = Math.floor(Math.random() * 30) + 22;
  const color = scoreColor(score);
  const dz    = document.getElementById('drop-zone');
  dz.style.pointerEvents = '';
  dz.innerHTML = `
    <div class="result-display">
      <div class="result-score" style="color:${color}">${score}</div>
      <div class="result-label">Your ATS Score (Demo)</div>
      <p class="result-msg">Backend not connected — demo mode active. Add your API key and start the server for real analysis.</p>
      <button class="btn-primary result-pay-btn" onclick="startPayment()">
        Get Full Report — ₹499
      </button>
      <button class="btn-retry" onclick="resetDropZone()">↺ Try again</button>
    </div>`;
  showToast('Demo mode — backend offline', 'error');
}

// ============================================
// PAYMENT FLOW — Razorpay
// ============================================
async function startPayment() {
  if (!currentScanId) {
    showToast('Please scan your resume first.', 'error'); return;
  }

  // Show loading on button
  const payBtn = document.querySelector('.result-pay-btn');
  if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Creating order…'; }

  try {
    // 1. Create Razorpay order
    const orderRes  = await fetch(`${API_BASE}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: currentScanId }),
    });
    const orderData = await orderRes.json();

    if (!orderRes.ok) throw new Error(orderData.error || 'Could not create order');

    // Demo mode — skip Razorpay modal
    if (orderData.demo || currentScanId === 'DEMO') {
      await verifyAndFetchReport({ demo: true, scanId: currentScanId });
      return;
    }

    // 2. Open Razorpay checkout
    const options = {
      key:         orderData.keyId,
      amount:      orderData.amount,
      currency:    orderData.currency,
      name:        'ResumeIQ',
      description: 'Full Resume Analysis Report',
      order_id:    orderData.orderId,
      prefill: {
        name:  '',
        email: '',
        contact: '',
      },
      theme: { color: '#6366f1' },
      modal: {
        ondismiss() {
          if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Get Full Report — ₹499`; }
          showToast('Payment cancelled.', 'error');
        },
      },
      handler: async function (response) {
        // 3. Verify payment on backend
        await verifyAndFetchReport({
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature:  response.razorpay_signature,
          scanId:              currentScanId,
        });
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();

  } catch (err) {
    if (payBtn) { payBtn.disabled = false; payBtn.textContent = 'Get Full Report — ₹499'; }
    showToast(err.message || 'Payment failed. Please try again.', 'error');
  }
}

// ============================================
// VERIFY PAYMENT + FETCH FULL REPORT
// ============================================
async function verifyAndFetchReport(paymentData) {
  const dz = document.getElementById('drop-zone');

  dz.innerHTML = `
    <div class="analyzing">
      <div class="analyze-spinner"></div>
      <p>Payment confirmed ✓</p>
      <span>Running full 47-signal analysis…</span>
    </div>`;
  dz.style.pointerEvents = 'none';

  try {
    // Step 1: Verify payment → get reportToken
    const verifyRes  = await fetch(`${API_BASE}/api/payment/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentData),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verifyData.error || 'Payment verification failed');

    const { reportToken } = verifyData;

    // Step 2: Fetch full report using token
    const steps = [
      'Analyzing 47 ATS signals…', 'Scoring keyword density…',
      'Evaluating impact language…', 'Checking format compliance…',
      'Building your fix plan…',
    ];
    let si = 0;
    const stepInterval = setInterval(() => {
      si = (si + 1) % steps.length;
      const el = dz.querySelector('span');
      if (el) el.textContent = steps[si];
    }, 1200);

    const reportRes  = await fetch(`${API_BASE}/api/analyze/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportToken }),
    });
    clearInterval(stepInterval);

    const reportData = await reportRes.json();
    if (!reportRes.ok) throw new Error(reportData.error || 'Report generation failed');

    // Step 3: Show full report modal
    dz.style.pointerEvents = '';
    resetDropZone();
    openReportModal(reportData.analysis);
    showToast('Full report ready! 🎉', 'success');

  } catch (err) {
    dz.style.pointerEvents = '';
    resetDropZone();
    showToast(err.message || 'Something went wrong. Contact support.', 'error');
  }
}

// ============================================
// FULL REPORT MODAL
// ============================================
function openReportModal(a) {
  const overlay = document.getElementById('report-overlay');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  // Date stamp
  document.getElementById('report-date').textContent =
    new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  // Score ring animation
  const score  = a.overallScore ?? 0;
  const circle = document.getElementById('report-ring-circle');
  const circumference = 427;
  const offset = circumference - (score / 100) * circumference;

  // Set gradient color based on score
  const c1 = score < 40 ? '#ef4444' : score < 65 ? '#f59e0b' : '#6366f1';
  const c2 = score < 40 ? '#f97316' : score < 65 ? '#eab308' : '#a855f7';
  document.getElementById('grad-stop-1').setAttribute('stop-color', c1);
  document.getElementById('grad-stop-2').setAttribute('stop-color', c2);

  setTimeout(() => { circle.style.strokeDashoffset = offset; }, 100);

  // Score number + grade
  const scoreEl = document.getElementById('report-big-score');
  scoreEl.textContent = '0';
  scoreEl.style.color = scoreColor(score);
  animateNum(scoreEl, score, 1400);

  const gradeEl = document.getElementById('report-grade-badge');
  gradeEl.textContent = a.grade ?? '';
  gradeEl.className = `report-grade-badge grade-${(a.grade ?? 'F').toLowerCase()}`;

  // Summary
  document.getElementById('report-summary').textContent = a.summary ?? '';

  // Callback rate
  document.getElementById('report-callback').innerHTML =
    `<span class="callback-label">Estimated callback rate:</span>
     <span class="callback-value">${escHtml(a.estimatedCallbackRate ?? '')}</span>`;

  // Meta row
  const meta = a.meta ?? {};
  document.getElementById('report-meta-row').innerHTML = [
    meta.wordCount         && `<span>${meta.wordCount} words</span>`,
    meta.estimatedPages    && `<span>~${meta.estimatedPages} page${meta.estimatedPages > 1 ? 's' : ''}</span>`,
    meta.hasContactInfo !== undefined && `<span>${meta.hasContactInfo ? '✓' : '✗'} Contact info</span>`,
    meta.hasSummary !== undefined     && `<span>${meta.hasSummary ? '✓' : '✗'} Summary section</span>`,
    meta.hasSkills !== undefined      && `<span>${meta.hasSkills ? '✓' : '✗'} Skills section</span>`,
  ].filter(Boolean).join('');

  // Category breakdown
  const cats = a.categories ?? {};
  document.getElementById('report-categories').innerHTML = Object.values(cats).map(c => {
    const sc  = c.score ?? 0;
    const col = scoreColor(sc);
    const st  = c.status ?? 'good';
    return `
      <div class="report-cat-card report-cat-${st}">
        <div class="report-cat-header">
          <span class="report-cat-label">${escHtml(c.label ?? '')}</span>
          <span class="report-cat-score" style="color:${col}">${sc}</span>
        </div>
        <div class="report-cat-bar-track">
          <div class="report-cat-bar-fill" style="width:${sc}%;background:${col}"></div>
        </div>
        ${c.topIssue ? `<p class="report-cat-issue">${escHtml(c.topIssue)}</p>` : ''}
      </div>`;
  }).join('');

  // Critical Issues
  const issues = a.criticalIssues ?? [];
  document.getElementById('report-issues').innerHTML =
    issues.map(i => `<li><span class="issue-bullet">!</span>${escHtml(i)}</li>`).join('') ||
    '<li>No critical issues found — great work!</li>';

  // Top Fixes
  const fixes = a.topFixes ?? [];
  document.getElementById('report-fixes').innerHTML = fixes.map((f, idx) => `
    <div class="fix-card fix-${(f.impact ?? 'medium').toLowerCase()}">
      <div class="fix-header">
        <span class="fix-num">${idx + 1}</span>
        <span class="fix-cat">${escHtml(f.category ?? '')}</span>
        <span class="fix-impact fix-impact-${(f.impact ?? 'medium').toLowerCase()}">${escHtml(f.impact ?? '')}</span>
      </div>
      <p class="fix-issue">${escHtml(f.issue ?? '')}</p>
      <div class="fix-body">
        <p class="fix-how-label">How to fix:</p>
        <p class="fix-how">${escHtml(f.fix ?? '')}</p>
      </div>
    </div>`).join('');

  // Keywords
  const found   = a.keywordsFound   ?? [];
  const missing = a.keywordsMissing ?? [];
  document.getElementById('kw-found').innerHTML =
    found.map(k => `<span class="kw-tag kw-found">${escHtml(k)}</span>`).join('') || '<span class="kw-empty">None detected</span>';
  document.getElementById('kw-missing').innerHTML =
    missing.map(k => `<span class="kw-tag kw-missing">${escHtml(k)}</span>`).join('') || '<span class="kw-empty">None missing — great!</span>';

  // Verb upgrade
  const weak    = a.weakVerbs              ?? [];
  const strong  = a.strongVerbSuggestions  ?? [];
  const verbRows = Math.max(weak.length, strong.length);
  document.getElementById('report-verbs-grid').innerHTML =
    verbRows === 0
      ? '<p style="color:var(--text-dim);font-size:.88rem">No weak verbs detected — strong language throughout.</p>'
      : `<div class="verb-table">
           <div class="verb-col">
             <p class="verb-col-title red-text">Weak (replace these)</p>
             ${weak.map(v => `<div class="verb-chip verb-weak">${escHtml(v)}</div>`).join('')}
           </div>
           <div class="verb-arrow-col">
             ${Array(Math.max(weak.length, strong.length)).fill('<div class="verb-arrow">→</div>').join('')}
           </div>
           <div class="verb-col">
             <p class="verb-col-title green-text">Strong (use instead)</p>
             ${strong.map(v => `<div class="verb-chip verb-strong">${escHtml(v)}</div>`).join('')}
           </div>
         </div>`;

  // Format warnings
  const warnings = a.formatWarnings ?? [];
  const formatEl = document.getElementById('report-format');
  const sectionF = document.getElementById('section-format');
  if (warnings.length === 0) {
    sectionF.style.display = 'none';
  } else {
    sectionF.style.display = '';
    formatEl.innerHTML = warnings.map(w => `<li>${escHtml(w)}</li>`).join('');
  }

  // Strengths
  const strengths = a.topStrengths ?? [];
  document.getElementById('report-strengths').innerHTML =
    strengths.map(s => `<div class="strength-card">★ ${escHtml(s)}</div>`).join('') ||
    '<div class="strength-card">Keep working on it — strengths will emerge!</div>';

  // Scroll to top of modal
  document.getElementById('report-modal').scrollTop = 0;

  // Store for PDF download
  window._reportData = { analysis: a, file: currentFile?.name ?? 'resume' };
}

function closeReport() {
  const overlay = document.getElementById('report-overlay');
  overlay.hidden = true;
  document.body.style.overflow = '';
}

// Close via button or overlay click
document.getElementById('report-close').addEventListener('click', closeReport);
document.getElementById('report-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeReport();
});
// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeReport();
});

// ============================================
// DOWNLOAD REPORT AS TEXT (upgrade later to PDF)
// ============================================
function downloadReport() {
  const d = window._reportData;
  if (!d) return;
  const a = d.analysis;
  const lines = [
    `ResumeIQ — Full Analysis Report`,
    `Date: ${new Date().toLocaleDateString('en-IN')}`,
    `File: ${d.file}`,
    `═════════════════════════════════`,
    ``,
    `OVERALL SCORE: ${a.overallScore}/100  Grade: ${a.grade}`,
    `Estimated callback rate: ${a.estimatedCallbackRate}`,
    ``,
    a.summary,
    ``,
    `── CATEGORY BREAKDOWN ──`,
    ...Object.values(a.categories ?? {}).map(c => `${c.label}: ${c.score}/100 — ${c.topIssue ?? ''}`),
    ``,
    `── CRITICAL ISSUES ──`,
    ...(a.criticalIssues ?? []).map((i, n) => `${n + 1}. ${i}`),
    ``,
    `── FIX PLAN ──`,
    ...(a.topFixes ?? []).map((f, n) =>
      `[${n + 1}] ${f.category} — ${f.impact}\nIssue: ${f.issue}\nFix: ${f.fix}`
    ),
    ``,
    `── KEYWORDS MISSING ──`,
    (a.keywordsMissing ?? []).join(', '),
    ``,
    `── KEYWORDS FOUND ──`,
    (a.keywordsFound ?? []).join(', '),
    ``,
    `── WEAK VERBS TO REPLACE ──`,
    (a.weakVerbs ?? []).join(', '),
    `Suggested replacements: ${(a.strongVerbSuggestions ?? []).join(', ')}`,
    ``,
    `── STRENGTHS ──`,
    ...(a.topStrengths ?? []).map(s => `★ ${s}`),
    ``,
    `Generated by ResumeIQ`,
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const el   = document.createElement('a');
  el.href    = url;
  el.download = `ResumeIQ_Report_${Date.now()}.txt`;
  el.click();
  URL.revokeObjectURL(url);
  showToast('Report downloaded!', 'success');
}

// ============================================
// RESET DROP ZONE
// ============================================
function resetDropZone() {
  const dz = document.getElementById('drop-zone');
  dz.style.pointerEvents = '';
  dz.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <p>Drop your resume here</p>
    <span>PDF, DOCX, or DOC — max 5MB</span>
    <input type="file" id="file-input" accept=".pdf,.doc,.docx" hidden />
    <button class="btn-upload" onclick="document.getElementById('file-input').click()">Browse Files</button>`;
  const newInput = document.getElementById('file-input');
  if (newInput) newInput.addEventListener('change', () => {
    if (newInput.files.length) handleFile(newInput.files[0]);
  });
}

// ============================================
// HELPERS
// ============================================
function scoreColor(score) {
  if (score < 40) return '#ef4444';
  if (score < 65) return '#f59e0b';
  return '#22c55e';
}

function animateNum(el, target, duration) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.round((1 - Math.pow(1 - progress, 3)) * target);
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// TOAST
// ============================================
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ============================================
// SMOOTH NAV LINKS
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', (e) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});
