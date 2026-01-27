const fs = require('fs');
const path = require('path');

const { buildGoogleAiUrl } = require('./google-ai');

const PDF_FILENAME = 'revised-cv.pdf';

function sanitizePdfText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '');
}

function encodePdfText(text) {
  const cleaned = sanitizePdfText(text).replace(/\t/g, '    ');
  const utf16le = Buffer.from(cleaned, 'utf16le');
  for (let i = 0; i < utf16le.length; i += 2) {
    const temp = utf16le[i];
    utf16le[i] = utf16le[i + 1];
    utf16le[i + 1] = temp;
  }
  return `<${utf16le.toString('hex').toUpperCase()}>`;
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

function collectCodePoints(lines) {
  const codePoints = new Set();
  lines.forEach((line) => {
    for (const char of line) {
      codePoints.add(char.codePointAt(0));
    }
  });
  return Array.from(codePoints).sort((a, b) => a - b);
}

function encodeCodePointHex(codePoint) {
  const utf16le = Buffer.from(String.fromCodePoint(codePoint), 'utf16le');
  for (let i = 0; i < utf16le.length; i += 2) {
    const temp = utf16le[i];
    utf16le[i] = utf16le[i + 1];
    utf16le[i + 1] = temp;
  }
  return utf16le.toString('hex').toUpperCase();
}

function buildToUnicodeCmap(codePoints) {
  const entries = codePoints.map((codePoint) => {
    const hex = encodeCodePointHex(codePoint);
    return `<${hex}> <${hex}>`;
  });
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    lines.push(...chunk);
    lines.push('endbfchar');
  }
  lines.push('endcmap');
  lines.push('CMapName currentdict /CMap defineresource pop');
  lines.push('end');
  lines.push('end');
  return lines.join('\n');
}

function loadFontBuffer(filename, base64EnvVar) {
  if (base64EnvVar) {
    return Buffer.from(base64EnvVar, 'base64');
  }
  const fontPath = path.resolve(__dirname, '..', '..', 'assets', 'fonts', filename);
  return fs.readFileSync(fontPath);
}

function addFontObjects(objects, fontName, fontBuffer, toUnicodeCmap) {
  const baseId = objects.length + 1;
  const fontFileId = baseId;
  const fontDescriptorId = baseId + 1;
  const toUnicodeId = baseId + 2;
  const cidFontId = baseId + 3;
  const type0FontId = baseId + 4;

  objects.push(
    `${fontFileId} 0 obj\n<< /Length ${fontBuffer.length} /Length1 ${fontBuffer.length} >>\nstream\n${fontBuffer.toString('latin1')}\nendstream\nendobj`,
    `${fontDescriptorId} 0 obj\n<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /FontBBox [-600 -300 1200 1000] /Ascent 1069 /Descent -293 /CapHeight 714 /ItalicAngle 0 /StemV 80 /FontFile2 ${fontFileId} 0 R >>\nendobj`,
    `${toUnicodeId} 0 obj\n<< /Length ${Buffer.byteLength(toUnicodeCmap, 'latin1')} >>\nstream\n${toUnicodeCmap}\nendstream\nendobj`,
    `${cidFontId} 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescriptorId} 0 R /DW 600 /CIDToGIDMap /Identity >>\nendobj`,
    `${type0FontId} 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>\nendobj`,
  );

  return type0FontId;
}

function wrapPdfLines(lines, maxCharsPerLine) {
  return lines.flatMap((line) => {
    const expanded = sanitizePdfText(line).replace(/\t/g, '    ');
    if (expanded.length <= maxCharsPerLine) {
      return [expanded];
    }
    const wrapped = [];
    let remaining = expanded;
    while (remaining.length > maxCharsPerLine) {
      const segment = remaining.slice(0, maxCharsPerLine);
      const lastSpace = segment.lastIndexOf(' ');
      const splitIndex = lastSpace > 0 ? lastSpace : maxCharsPerLine;
      wrapped.push(remaining.slice(0, splitIndex).trimEnd());
      remaining = remaining.slice(splitIndex).trimStart();
    }
    if (remaining.length > 0) {
      wrapped.push(remaining);
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
  const maxCharsPerLine = Math.floor((pageWidth - startX * 2) / (fontSize * 0.6));
  const lines = wrapPdfLines(normalized.split('\n'), maxCharsPerLine);
  const maxLinesPerPage = 40;
  const pages = [];
  const nameIndex = getNameLineIndex(lines);
  const codePoints = collectCodePoints(lines);

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
      const lineStartY = startY - lineHeight * index;
      const position = `1 0 0 1 ${lineStartX} ${lineStartY} Tm`;
      return `${position}\n/${fontId} ${lineFontSize} Tf\n${encodePdfText(line)} Tj`;
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

  const toUnicodeCmap = buildToUnicodeCmap(codePoints);
  const regularFontBuffer = loadFontBuffer(
    'NotoSans-Regular.ttf',
    process.env.NOTO_SANS_REGULAR_BASE64,
  );
  const boldFontBuffer = loadFontBuffer(
    'NotoSans-Bold.ttf',
    process.env.NOTO_SANS_BOLD_BASE64,
  );
  const regularFontId = addFontObjects(objects, 'NotoSans-Regular', regularFontBuffer, toUnicodeCmap);
  const boldFontId = addFontObjects(objects, 'NotoSans-Bold', boldFontBuffer, toUnicodeCmap);

  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> >>\nendobj`,
      `${contentObjectId} 0 obj\n<< /Length ${page.streamLength} >>\nstream\n${page.stream}\nendstream\nendobj`,
    );
  });

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
