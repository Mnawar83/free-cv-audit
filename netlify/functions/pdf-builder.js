const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const PAGE_MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

function sanitizePdfText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\uFFFD]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, ' - ')
    .replace(/\s+\|\s+/g, ' | ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSourcePageMarker(line) {
  const normalized = line.toLowerCase().trim();
  if (!normalized) return false;
  return (
    /^page\s+\d+(\s+of\s+\d+)?$/.test(normalized) ||
    /^-\s*page\s+\d+(\s+of\s+\d+)?\s*-$/.test(normalized) ||
    /^p(age)?\.?\s*\d+\s*(\/|of)\s*\d+$/.test(normalized)
  );
}

function transliterateToAscii(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe')
    .replace(/Ð/g, 'D')
    .replace(/ð/g, 'd')
    .replace(/Þ/g, 'Th')
    .replace(/þ/g, 'th')
    .replace(/Ł/g, 'L')
    .replace(/ł/g, 'l')
    .replace(/[^\x20-\x7E\n]/g, '');
}

function encodePdfText(text) {
  return transliterateToAscii(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function normalizeHeading(line) {
  return line.toLowerCase().replace(/[^a-z ]/g, '').trim();
}

function headingToSection(line) {
  const cleaned = normalizeHeading(line).replace(/\s+/g, ' ');
  const matches = [
    ['professional summary', 'summary'],
    ['summary', 'summary'],
    ['profile', 'summary'],
    ['core skills', 'skills'],
    ['skills', 'skills'],
    ['professional experience', 'experience'],
    ['experience', 'experience'],
    ['employment history', 'experience'],
    ['education', 'education'],
    ['certifications', 'certifications'],
    ['training', 'certifications'],
    ['languages', 'languages'],
    ['additional information', 'additional'],
  ];
  const found = matches.find(([key]) => cleaned === key || cleaned.startsWith(`${key} `));
  return found ? found[1] : null;
}

function looksLikeContactLine(line) {
  return /@|linkedin|\+?\d[\d\s().-]{6,}|\|/.test(line.toLowerCase());
}

function splitAndCleanLines(text) {
  return sanitizePdfText(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s{2,}/g, ' '))
    .filter((line) => !isSourcePageMarker(line))
    .filter((line, idx, arr) => line || (arr[idx - 1] && arr[idx - 1] !== ''));
}

function parseCv(text) {
  const lines = splitAndCleanLines(text);
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor]) cursor += 1;

  const header = { name: '', title: '', contact: '' };
  header.name = lines[cursor] || 'Candidate Name';
  cursor += 1;

  if (lines[cursor] && !headingToSection(lines[cursor]) && !looksLikeContactLine(lines[cursor])) {
    header.title = lines[cursor];
    cursor += 1;
  }

  const contactParts = [];
  while (cursor < lines.length && lines[cursor] && !headingToSection(lines[cursor])) {
    if (looksLikeContactLine(lines[cursor])) {
      contactParts.push(lines[cursor].replace(/\s*\|\s*/g, ' | '));
      cursor += 1;
      continue;
    }
    break;
  }
  header.contact = contactParts.join(' | ').replace(/\s+\|\s+/g, ' | ');

  const rawSections = { summary: [], skills: [], experience: [], education: [], certifications: [], languages: [], additional: [] };
  let currentSection = 'summary';

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line) {
      rawSections[currentSection].push('');
      continue;
    }
    const detected = headingToSection(line.replace(/:$/, ''));
    if (detected) {
      currentSection = detected;
      continue;
    }
    if (!isSourcePageMarker(line)) {
      rawSections[currentSection].push(line);
    }
  }

  return {
    header,
    sections: {
      summary: rawSections.summary.filter(Boolean).join(' '),
      skills: normalizeSkills(rawSections.skills),
      experience: parseExperience(rawSections.experience),
      education: parseSimpleList(rawSections.education),
      certifications: parseBullets(rawSections.certifications),
      languages: parseBullets(rawSections.languages),
      additional: parseBullets(rawSections.additional),
    },
  };
}

function normalizeSkills(lines) {
  const entries = lines
    .flatMap((line) => line.split(/[|,•]/g))
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .filter((item) => !isSourcePageMarker(item));
  return [...new Set(entries)];
}

function parseSimpleList(lines) {
  const items = [];
  let acc = [];
  for (const line of lines) {
    if (!line) {
      if (acc.length) items.push(acc.join(' | '));
      acc = [];
      continue;
    }
    const cleaned = line.replace(/^[-*]\s*/, '').trim();
    if (!isSourcePageMarker(cleaned)) acc.push(cleaned);
  }
  if (acc.length) items.push(acc.join(' | '));
  return items;
}

function parseBullets(lines) {
  return lines
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !isSourcePageMarker(line))
    .filter((line, idx, arr) => arr.indexOf(line) === idx);
}

function parseExperience(lines) {
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if (!line) {
      if (current.length) chunks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) chunks.push(current);

  return chunks.map((chunk) => {
    const bullets = chunk.filter((line) => /^[-*•]/.test(line)).map((line) => line.replace(/^[-*•]\s*/, '').trim());
    const plain = chunk.filter((line) => !/^[-*•]/.test(line));
    return {
      employer: plain[0] || '',
      roleLine: plain[1] || '',
      dateLine: plain[2] || '',
      bullets: bullets.filter((line) => !isSourcePageMarker(line)).slice(0, 6),
    };
  }).filter((entry) => entry.employer || entry.roleLine || entry.bullets.length);
}

function wrapLine(text, fontSize, maxWidth) {
  const charsPerLine = Math.max(10, Math.floor(maxWidth / (fontSize * 0.53)));
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (candidate.length > charsPerLine) {
      lines.push(current);
      current = words[i];
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function sectionHeading(title) {
  return { type: 'heading', text: title, font: 'F2', size: 11, spacingBefore: 14, spacingAfter: 6, keepWithNext: true };
}

function buildBlocks(cv) {
  const blocks = [];
  blocks.push({ type: 'line', text: cv.header.name, font: 'F2', size: 20, spacingBefore: 0, spacingAfter: 6 });
  if (cv.header.title) blocks.push({ type: 'line', text: cv.header.title, font: 'F2', size: 12, spacingBefore: 0, spacingAfter: 4 });
  if (cv.header.contact) blocks.push({ type: 'line', text: cv.header.contact, font: 'F1', size: 10, spacingBefore: 0, spacingAfter: 10 });

  if (cv.sections.summary) {
    blocks.push(sectionHeading('PROFESSIONAL SUMMARY'));
    blocks.push({ type: 'paragraph', text: cv.sections.summary, font: 'F1', size: 10.5, spacingBefore: 0, spacingAfter: 8 });
  }

  if (cv.sections.skills.length) {
    blocks.push(sectionHeading('CORE SKILLS'));
    blocks.push({ type: 'paragraph', text: cv.sections.skills.join(' | '), font: 'F1', size: 10.5, spacingBefore: 0, spacingAfter: 8 });
  }

  if (cv.sections.experience.length) {
    blocks.push(sectionHeading('PROFESSIONAL EXPERIENCE'));
    cv.sections.experience.forEach((entry) => {
      blocks.push({ type: 'groupStart' });
      if (entry.employer) blocks.push({ type: 'line', text: entry.employer, font: 'F2', size: 11, spacingBefore: 0, spacingAfter: 2 });
      if (entry.roleLine) blocks.push({ type: 'line', text: entry.roleLine, font: 'F1', size: 10.5, spacingBefore: 0, spacingAfter: 1 });
      if (entry.dateLine) blocks.push({ type: 'line', text: entry.dateLine, font: 'F1', size: 9.5, spacingBefore: 0, spacingAfter: 3 });
      entry.bullets.forEach((bullet) => {
        blocks.push({ type: 'bullet', text: bullet, font: 'F1', size: 10, spacingBefore: 0, spacingAfter: 1 });
      });
      blocks.push({ type: 'spacer', height: 5 });
      blocks.push({ type: 'groupEnd' });
    });
  }

  const optionalSections = [
    ['EDUCATION', cv.sections.education],
    ['CERTIFICATIONS / TRAINING', cv.sections.certifications],
    ['LANGUAGES', cv.sections.languages],
    ['ADDITIONAL INFORMATION', cv.sections.additional],
  ];

  optionalSections.forEach(([title, items]) => {
    if (!items.length) return;
    blocks.push(sectionHeading(title));
    items.forEach((item) => {
      blocks.push({ type: 'bullet', text: item, font: 'F1', size: 10, spacingBefore: 0, spacingAfter: 1 });
    });
  });

  return blocks;
}

function sanitizeBlocks(blocks) {
  const cleaned = [];
  const seenHeadings = new Set();

  for (const block of blocks) {
    if ((block.type === 'line' || block.type === 'paragraph' || block.type === 'bullet' || block.type === 'heading') && !block.text?.trim()) {
      continue;
    }
    if (block.text && isSourcePageMarker(block.text)) {
      continue;
    }
    if (block.type === 'heading') {
      if (seenHeadings.has(block.text)) continue;
      seenHeadings.add(block.text);
    }
    cleaned.push(block);
  }
  return cleaned;
}

function estimateBlockHeight(block) {
  if (block.type === 'spacer') return block.height;
  const lineHeight = Math.ceil((block.size || 10) * 1.45);
  const indent = block.type === 'bullet' ? 14 : 0;
  const wrapped = wrapLine(block.text || '', block.size || 10, CONTENT_WIDTH - indent);
  return (block.spacingBefore || 0) + wrapped.length * lineHeight + (block.spacingAfter || 0);
}

function renderPageContent(renderLines) {
  return `BT\n${renderLines.join('\n')}\nET`;
}

function buildPdfFromPages(pages) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj`,
  ];

  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const stream = page.stream;
    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R /F2 ${4 + pages.length * 2} 0 R >> >> >>\nendobj`,
      `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj`,
    );
  });

  const regularFontObjectId = 3 + pages.length * 2;
  const boldFontObjectId = 4 + pages.length * 2;
  objects.push(
    `${regularFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `${boldFontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
  );

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${object}\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function removeIsolatedPageLabelPages(pages) {
  return pages.filter((page) => {
    const matches = page.stream.match(/\((.*?)\)\sTj/g) || [];
    const extracted = matches.map((m) => m.replace(/^\(/, '').replace(/\)\sTj$/, ''));
    if (!extracted.length) return false;
    const nonPageLabels = extracted.filter((text) => !/^Page \d+$/.test(text));
    return nonPageLabels.length > 0;
  });
}

function buildPdfBuffer(text) {
  const cv = parseCv(text);
  const blocks = sanitizeBlocks(buildBlocks(cv));

  const pages = [];
  let currentPageLines = [];
  let y = A4_HEIGHT - PAGE_MARGIN;
  const footerGap = 22;
  const minY = PAGE_MARGIN + footerGap;

  function pushPage() {
    if (!currentPageLines.length) {
      return;
    }
    const pageIndex = pages.length + 1;
    currentPageLines.push(`1 0 0 1 ${PAGE_MARGIN} ${PAGE_MARGIN - 6} Tm\n/F1 8 Tf\n(${encodePdfText(`Page ${pageIndex}`)}) Tj`);
    pages.push({ stream: renderPageContent(currentPageLines) });
    currentPageLines = [];
    y = A4_HEIGHT - PAGE_MARGIN;
  }

  let groupBuffer = [];
  let inGroup = false;

  function flushGroup() {
    if (!groupBuffer.length) return;
    const groupHeight = groupBuffer.reduce((sum, b) => sum + estimateBlockHeight(b), 0);
    if (y - groupHeight < minY) pushPage();
    groupBuffer.forEach(renderBlock);
    groupBuffer = [];
  }

  function renderBlock(block) {
    if (block.type === 'spacer') {
      y -= block.height;
      return;
    }
    const lineHeight = Math.ceil((block.size || 10) * 1.45);
    const isBullet = block.type === 'bullet';
    const indent = isBullet ? 14 : 0;
    const wrapped = wrapLine(block.text || '', block.size || 10, CONTENT_WIDTH - indent);

    y -= block.spacingBefore || 0;
    wrapped.forEach((line, idx) => {
      if (y - lineHeight < minY) pushPage();
      const drawX = PAGE_MARGIN + indent;
      if (isBullet && idx === 0) {
        currentPageLines.push(`1 0 0 1 ${PAGE_MARGIN + 3} ${y} Tm\n/F1 10 Tf\n(${encodePdfText('-')}) Tj`);
      }
      currentPageLines.push(`1 0 0 1 ${drawX} ${y} Tm\n/${block.font || 'F1'} ${block.size || 10} Tf\n(${encodePdfText(line)}) Tj`);
      y -= lineHeight;
    });
    y -= block.spacingAfter || 0;
  }

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'groupStart') {
      inGroup = true;
      groupBuffer = [];
      return;
    }
    if (block.type === 'groupEnd') {
      inGroup = false;
      flushGroup();
      return;
    }

    if (inGroup) {
      groupBuffer.push(block);
      return;
    }

    if (block.keepWithNext) {
      const next = blocks[blockIndex + 1];
      const combinedHeight = estimateBlockHeight(block) + (next ? estimateBlockHeight(next) : 0);
      if (y - combinedHeight < minY) pushPage();
    }

    if (y - estimateBlockHeight(block) < minY) pushPage();
    renderBlock(block);
  });

  flushGroup();

  if (!currentPageLines.length) {
    currentPageLines.push(`1 0 0 1 ${PAGE_MARGIN} ${A4_HEIGHT - PAGE_MARGIN} Tm\n/F1 10 Tf\n(${encodePdfText('CV generated successfully.')}) Tj`);
  }
  pushPage();

  const cleanedPages = removeIsolatedPageLabelPages(pages);
  return buildPdfFromPages(cleanedPages.length ? cleanedPages : pages);
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
