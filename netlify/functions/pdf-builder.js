function sanitizePdfText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '');
}

function normalizeForDetection(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
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

function pdfResponse(pdfBuffer, filename, inline = false) {
  const disposition = inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true,
  };
}

module.exports = { buildPdfBuffer, pdfResponse };
