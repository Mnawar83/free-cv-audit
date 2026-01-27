const { buildGoogleAiUrl } = require('./google-ai');

const PDF_FILENAME = 'revised-cv.pdf';

function sanitizePdfText(text) {
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u00b7\u25aa\u25cf]/g, '*')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  return normalized
    .replace(/[^\x09\x20-\x7e]/g, ' ')
    ;
}

function encodePdfText(text) {
  return sanitizePdfText(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\t/g, '    ');
}

function getNameLineIndex(lines) {
  return lines.findIndex((line) => line.trim().length > 0);
}

function isHeadingLine(line, index, nameIndex) {
  if (index === nameIndex) {
    return false;
  }
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.endsWith(':')) {
    return true;
  }
  return trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
}

function estimateCenteredX(text, fontSize, pageWidth, minX) {
  const sanitized = sanitizePdfText(text).replace(/\t/g, '    ');
  const estimatedWidth = sanitized.length * fontSize * 0.6;
  const centered = (pageWidth - estimatedWidth) / 2;
  return Math.max(minX, centered);
}

function buildPdfBuffer(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const fontSize = 12;
  const nameFontSize = 14;
  const lineHeight = 16;
  const startX = 72;
  const startY = 720;
  const pageWidth = 612;
  const maxLinesPerPage = 40;
  const pages = [];
  const nameIndex = getNameLineIndex(lines);

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    const pageLines = lines.slice(i, i + maxLinesPerPage);
    const contentLines = pageLines.map((line, index) => {
      const absoluteIndex = i + index;
      const isNameLine = absoluteIndex === nameIndex;
      const isHeading = isHeadingLine(line, absoluteIndex, nameIndex);
      const lineFontSize = isNameLine ? nameFontSize : fontSize;
      const fontId = isNameLine || isHeading ? 'F2' : 'F1';
      const lineStartX = isNameLine
        ? estimateCenteredX(line, lineFontSize, pageWidth, startX)
        : startX;
      const position = index === 0 ? `${lineStartX} ${startY} Td` : `0 -${lineHeight} Td`;
      return `${position}\n/${fontId} ${lineFontSize} Tf\n(${encodePdfText(line)}) Tj`;
    });
    const stream = `BT\n${contentLines.join('\n')}\nET`;
    pages.push({
      stream,
      streamLength: Buffer.byteLength(stream, 'utf8'),
    });
  }

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj`,
  ];

  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R /F2 ${4 + pages.length * 2} 0 R >> >> >>\nendobj`,
      `${contentObjectId} 0 obj\n<< /Length ${page.streamLength} >>\nstream\n${page.stream}\nendstream\nendobj`,
    );
  });

  const fontObjectId = 3 + pages.length * 2;
  const boldFontObjectId = fontObjectId + 1;
  objects.push(
    `${fontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `${boldFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { cvText } = JSON.parse(event.body || '{}');
    if (!cvText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const apiUrl = buildGoogleAiUrl(apiKey);

    const systemPrompt = `You are an expert CV writer for Work Waves Career Services.
Rewrite the CV for ATS compatibility and professional impact.
Return only the revised CV content, formatted as plain text with clear section headings.`;

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Rewrite this CV:\n\n${cvText}` }] }],
    };

    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: errorData.error?.message || 'AI request failed' }),
      };
    }

    const result = await fetchResponse.json();
    const revisedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!revisedText) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No response from AI' }) };
    }

    const pdfBuffer = buildPdfBuffer(revisedText);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${PDF_FILENAME}"`,
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
