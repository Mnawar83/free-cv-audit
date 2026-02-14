const { buildGoogleAiUrl } = require('./google-ai');
const { createRunId, upsertRun } = require('./run-store');

const PDF_FILENAME = 'revised-cv.pdf';

function sanitizePdfText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '');
}

function normalizeForDetection(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\u2026/g, '...')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function transliterateToAscii(text) {
  const normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const replacements = [
    [/ß/g, 'ss'],
    [/Æ/g, 'AE'],
    [/æ/g, 'ae'],
    [/Œ/g, 'OE'],
    [/œ/g, 'oe'],
    [/Ð/g, 'D'],
    [/ð/g, 'd'],
    [/Þ/g, 'Th'],
    [/þ/g, 'th'],
    [/Ł/g, 'L'],
    [/ł/g, 'l'],
  ];
  return replacements.reduce((result, [pattern, value]) => result.replace(pattern, value), normalized);
}

function renderText(text) {
  return transliterateToAscii(sanitizePdfText(text))
    .replace(/\t/g, '    ')
    .replace(/[^\x20-\x7E]/g, '?');
}

function encodePdfText(text) {
  return renderText(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function getNameLineIndex(lines) {
  return lines.findIndex((line) => normalizeForDetection(line).trim().length > 0);
}

function isHeadingLine(line, index, nameIndex) {
  if (index === nameIndex) {
    return false;
  }
  const trimmed = normalizeForDetection(line).trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.endsWith(':')) {
    return true;
  }
  return trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
}

function estimateCenteredX(text, fontSize, pageWidth, minX) {
  const rendered = renderText(text);
  const estimatedWidth = rendered.length * fontSize * 0.6;
  const centered = (pageWidth - estimatedWidth) / 2;
  return Math.max(minX, centered);
}

function wrapPdfLines(lines, getMaxCharsForLine) {
  return lines.flatMap((line, index) => {
    const rendered = renderText(line);
    const maxCharsPerLine = getMaxCharsForLine(index);
    if (rendered.length <= maxCharsPerLine) {
      return [{ line: rendered, sourceIndex: index }];
    }
    const wrapped = [];
    let remaining = rendered;
    while (remaining.length > maxCharsPerLine) {
      const segment = remaining.slice(0, maxCharsPerLine);
      const lastSpace = segment.lastIndexOf(' ');
      const splitIndex = lastSpace > 0 ? lastSpace : maxCharsPerLine;
      wrapped.push({ line: remaining.slice(0, splitIndex).trimEnd(), sourceIndex: index });
      remaining = remaining.slice(splitIndex).trimStart();
    }
    if (remaining.length > 0) {
      wrapped.push({ line: remaining, sourceIndex: index });
    }
    return wrapped;
  });
}

function buildPdfBuffer(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const fontSize = 12;
  const nameFontSize = 14;
  const lineHeight = 16;
  const startX = 72;
  const startY = 720;
  const pageWidth = 612;
  const originalLines = normalized.split('\n');
  const nameIndex = getNameLineIndex(originalLines);
  const maxCharsPerBodyLine = Math.floor((pageWidth - startX * 2) / (fontSize * 0.6));
  const maxCharsPerNameLine = Math.floor((pageWidth - startX * 2) / (nameFontSize * 0.6));
  const lines = wrapPdfLines(originalLines, (index) =>
    index === nameIndex ? maxCharsPerNameLine : maxCharsPerBodyLine,
  );
  const maxLinesPerPage = 40;
  const pages = [];

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    const pageLines = lines.slice(i, i + maxLinesPerPage);
    const contentLines = pageLines.map((lineItem, index) => {
      const { line, sourceIndex } = lineItem;
      const isNameLine = sourceIndex === nameIndex;
      const isHeading = isHeadingLine(originalLines[sourceIndex], sourceIndex, nameIndex);
      const lineFontSize = isNameLine ? nameFontSize : fontSize;
      const fontId = isNameLine || isHeading ? 'F2' : 'F1';
      const lineStartX = isNameLine
        ? estimateCenteredX(line, lineFontSize, pageWidth, startX)
        : startX;
      const lineStartY = startY - lineHeight * index;
      const position = `1 0 0 1 ${lineStartX} ${lineStartY} Tm`;
      return `${position}\n/${fontId} ${lineFontSize} Tf\n(${encodePdfText(line)}) Tj`;
    });
    const stream = `BT\n${contentLines.join('\n')}\nET`;
    pages.push({
      stream,
      streamLength: Buffer.byteLength(stream, 'latin1'),
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

  const regularFontObjectId = 3 + pages.length * 2;
  const boldFontObjectId = 4 + pages.length * 2;
  objects.push(
    `${regularFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `${boldFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${object}\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { cvText, cvAnalysis, runId: incomingRunId } = JSON.parse(event.body || '{}');
    if (!cvText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cvText is required' }) };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Google AI API key is missing.' }),
      };
    }
    const apiUrl = buildGoogleAiUrl(apiKey);

    const systemPrompt = `You are an expert CV writer for Work Waves Career Services.
Rewrite the CV for ATS compatibility and professional impact.
Return only the revised CV content, formatted as plain text with clear section headings.`;

    const analysisNote = cvAnalysis
      ? `\n\nUse this CV analysis as reference while revising:\n${cvAnalysis}`
      : '';
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Rewrite this CV:\n\n${cvText}${analysisNote}` }] }],
    };

    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fetchResponse.ok) {
      let errorMessage = 'AI request failed';
      try {
        const errorData = await fetchResponse.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (parseError) {
        console.error('Unable to parse AI error response.', parseError);
      }
      return {
        statusCode: 500,
        body: JSON.stringify({ error: errorMessage }),
      };
    }

    const result = await fetchResponse.json();
    const revisedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!revisedText) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No response from AI' }) };
    }

    const pdfBuffer = buildPdfBuffer(revisedText);
    const runId = incomingRunId || createRunId();
    await upsertRun(runId, {
      revised_cv_text: revisedText,
      revised_cv_generated_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${PDF_FILENAME}"`,
        'x-run-id': runId,
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Generate PDF failure.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
