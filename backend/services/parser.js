/**
 * Resume Parser Service
 * Extracts clean text from PDF and DOCX files
 * Files are passed as Buffer (never written to disk)
 */

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Detect file type from buffer magic bytes
 */
function detectFileType(buffer) {
  // PDF: starts with %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }
  // DOCX/ZIP: starts with PK (0x50 0x4B)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    return 'docx';
  }
  return 'unknown';
}

/**
 * Extract text from PDF buffer
 */
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer, {
      // Preserve as much structure as possible
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });

    const text = data.text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')   // collapse excess blank lines
      .trim();

    return {
      text,
      pageCount: data.numpages,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
    };
  } catch (err) {
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

/**
 * Extract text from DOCX buffer
 */
async function parseDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });

    const text = result.value
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      text,
      pageCount: null, // DOCX doesn't expose page count easily
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
    };
  } catch (err) {
    throw new Error(`DOCX parsing failed: ${err.message}`);
  }
}

/**
 * Main parse function — auto-detects file type
 */
async function parseResume(buffer, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file received');
  }

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('File exceeds 5MB limit');
  }

  const detectedType = detectFileType(buffer);

  // Trust MIME type as fallback
  const isPDF =
    detectedType === 'pdf' ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/x-pdf';

  const isDOCX =
    detectedType === 'docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword';

  let parsed;
  if (isPDF) {
    parsed = await parsePDF(buffer);
    parsed.fileType = 'pdf';
  } else if (isDOCX) {
    parsed = await parseDOCX(buffer);
    parsed.fileType = 'docx';
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOC, or DOCX.');
  }

  if (!parsed.text || parsed.text.length < 100) {
    throw new Error(
      'Could not extract readable text. Make sure your resume is not image-only or scanned.'
    );
  }

  return parsed;
}

module.exports = { parseResume };
