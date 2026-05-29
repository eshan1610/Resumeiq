/**
 * AI Analysis Service
 * Sends resume text to Claude and returns structured scoring + fix plan
 * Uses prompt caching to minimize API costs (~₹2 per full analysis)
 */

const { default: Anthropic } = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── SYSTEM PROMPT (cached — only charged once per 5 min TTL) ──────────────
const SYSTEM_PROMPT = `You are ResumeIQ, an expert ATS (Applicant Tracking System) analyst and career coach with deep knowledge of how Fortune 500 hiring systems work. You analyze resumes and return precise, actionable intelligence.

Your job is to analyze the resume text provided and return a structured JSON response. Be honest, specific, and brutally helpful. Do not flatter — job seekers need real feedback, not validation.

You must return ONLY valid JSON — no markdown, no explanation outside the JSON object.

Return exactly this structure:

{
  "overallScore": <integer 0–100>,
  "grade": <"A" | "B" | "C" | "D" | "F">,
  "summary": <2-sentence honest summary of the resume's current state>,
  "categories": {
    "atsCompatibility": {
      "score": <0–100>,
      "label": "ATS Compatibility",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    },
    "keywordMatch": {
      "score": <0–100>,
      "label": "Keyword Match",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    },
    "impactLanguage": {
      "score": <0–100>,
      "label": "Impact Language",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    },
    "credibility": {
      "score": <0–100>,
      "label": "Credibility",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    },
    "readability": {
      "score": <0–100>,
      "label": "Readability",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    },
    "interviewPotential": {
      "score": <0–100>,
      "label": "Interview Potential",
      "status": <"critical" | "warning" | "good">,
      "topIssue": <single most important issue, 1 sentence>
    }
  },
  "criticalIssues": [
    <array of up to 5 strings — the most urgent problems to fix, specific not generic>
  ],
  "topFixes": [
    {
      "priority": <1–5, 1 = highest>,
      "category": <"ATS" | "Keywords" | "Impact" | "Format" | "Credibility">,
      "issue": <what is wrong, specific to THIS resume>,
      "fix": <exact actionable fix with example if possible>,
      "impact": <"High" | "Medium" | "Low">
    }
  ],
  "keywordsFound": [<up to 10 strong keywords detected in the resume>],
  "keywordsMissing": [<up to 10 high-value keywords that should be added for a modern professional role>],
  "weakVerbs": [<any weak verbs found: "helped", "worked on", "assisted", "was responsible for", etc.>],
  "strongVerbSuggestions": [<5 powerful replacements: "drove", "architected", "spearheaded", "delivered", "optimized">],
  "quantificationScore": <integer 0–100 — how well the resume uses numbers/metrics>,
  "formatWarnings": [<list of format issues: multi-column, tables, headers/footers, graphics, unusual fonts, etc.>],
  "estimatedCallbackRate": <"Very Low (<5%)" | "Low (5–15%)" | "Average (15–30%)" | "High (30–50%)" | "Very High (>50%)">,
  "topStrengths": [<2–3 genuine strengths of this resume>],
  "meta": {
    "wordCount": <integer>,
    "estimatedPages": <1 | 2 | 3 | "3+">,
    "hasContactInfo": <boolean>,
    "hasSummary": <boolean>,
    "hasEducation": <boolean>,
    "hasExperience": <boolean>,
    "hasSkills": <boolean>
  }
}

Scoring guidelines:
- ATS Compatibility: Deduct heavily for multi-column layouts, tables, text boxes, headers/footers with contact info, non-standard section names, graphics/images, unusual fonts
- Keyword Match: Score based on presence of role-relevant technical and soft skill keywords common in modern job descriptions
- Impact Language: Score based on use of strong action verbs, quantified achievements (numbers, percentages, revenue), and specific outcomes
- Credibility: Score based on recognizable company names, educational institutions, certifications, awards, and measurable results
- Readability: Score based on appropriate length (1–2 pages ideal), clear section hierarchy, consistent formatting, bullet point quality
- Interview Potential: Holistic composite of all signals — would a recruiter call this person for an interview?

Be specific to the actual content of the resume — do not give generic feedback.`;

// ─── FREE SCAN PROMPT (lighter, no caching needed) ────────────────────────
const FREE_SCAN_SYSTEM = `You are ResumeIQ, an ATS resume analyzer. Analyze the resume and return ONLY valid JSON with this exact structure — no markdown, no text outside the JSON:

{
  "overallScore": <integer 0–100>,
  "grade": <"A"|"B"|"C"|"D"|"F">,
  "summary": <2-sentence honest assessment>,
  "categories": {
    "atsCompatibility": { "score": <0–100>, "status": <"critical"|"warning"|"good"> },
    "keywordMatch": { "score": <0–100>, "status": <"critical"|"warning"|"good"> },
    "impactLanguage": { "score": <0–100>, "status": <"critical"|"warning"|"good"> },
    "readability": { "score": <0–100>, "status": <"critical"|"warning"|"good"> }
  },
  "criticalIssues": [<top 3 specific issues — strings>],
  "estimatedCallbackRate": <"Very Low (<5%)"|"Low (5–15%)"|"Average (15–30%)"|"High (30–50%)"|"Very High (>50%)">,
  "topStrengths": [<2 genuine strengths>]
}`;

/**
 * Free scan — returns basic score + top 3 issues
 * Uses haiku for lower cost (~₹0.10 per scan)
 */
async function freeScan(resumeText) {
  const truncated = resumeText.slice(0, 3000); // haiku context limit friendly

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system: FREE_SCAN_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Analyze this resume:\n\n${truncated}`,
      },
    ],
  });

  return parseJSON(message.content[0].text);
}

/**
 * Full analysis — 47-signal deep breakdown
 * Uses Sonnet with prompt caching (~₹2.20 per analysis)
 */
async function fullAnalysis(resumeText) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // cache system prompt — reused across requests
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze this resume and return the full JSON report:\n\n${resumeText}`,
      },
    ],
  });

  return parseJSON(message.content[0].text);
}

/**
 * Safely parse JSON from Claude response
 * Handles cases where the model wraps output in markdown code blocks
 */
function parseJSON(text) {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Claude returned malformed JSON — please retry');
  }
}

module.exports = { freeScan, fullAnalysis };
