const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

function sanitizePdfText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uFFFD]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[•●▪◦]/g, '-')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function transliterateToAscii(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function encodePdfText(text) {
  return transliterateToAscii(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function isPageArtifact(line) {
  const v = line.trim().toLowerCase();
  return /^page\s+\d+(\s+of\s+\d+)?$/.test(v) || /^p\.?\s*\d+\s*(\/|of)\s*\d+$/.test(v);
}

function fixInnerWordSpacing(line) {
  return line
    .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, '$1$2')
    .replace(/\b([A-Za-z]{2,})\s+([A-Za-z]{1,2})\b/g, (m, a, b) => {
      if (a.length >= 4 && b.length <= 2) return `${a}${b}`;
      return m;
    });
}

function normalizeLine(line) {
  return fixInnerWordSpacing(line)
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeHeading(line) {
  return line.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

function sectionKeyForHeading(line) {
  const h = normalizeHeading(line);
  const map = {
    'professional summary': 'summary',
    summary: 'summary',
    profile: 'summary',
    'core skills': 'skills',
    skills: 'skills',
    'professional experience': 'experience',
    experience: 'experience',
    'employment history': 'experience',
    education: 'education',
    certifications: 'certifications',
    training: 'certifications',
    languages: 'languages',
    'additional information': 'additionalInfo',
  };
  return map[h] || null;
}

function toLines(inputText) {
  return sanitizePdfText(inputText)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isPageArtifact(line));
}

function parseContact(lines) {
  const joined = lines.join(' | ');
  const parts = joined.split('|').map((p) => p.trim()).filter(Boolean);
  const contact = { phone: '', email: '', location: '', nationality: '', linkedin: '' };
  for (const part of parts) {
    if (!contact.email && /@/.test(part)) contact.email = part;
    else if (!contact.linkedin && /linkedin\.com|^linkedin\b/i.test(part)) contact.linkedin = part;
    else if (!contact.phone && /\+?\d[\d\s().-]{6,}/.test(part)) contact.phone = part;
    else if (!contact.location) contact.location = part;
    else if (!contact.nationality) contact.nationality = part;
  }
  return contact;
}

function splitSections(lines) {
  const sections = {
    preface: [], summary: [], skills: [], experience: [], education: [], certifications: [], languages: [], additionalInfo: [],
  };
  let current = 'preface';

  for (const line of lines) {
    const key = sectionKeyForHeading(line.replace(/:$/, ''));
    if (key) {
      current = key;
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function parseExperience(lines) {
  const entries = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const bullets = buffer.filter((l) => /^[-*]\s*/.test(l)).map((l) => l.replace(/^[-*]\s*/, '').trim());
    const rows = buffer.filter((l) => !/^[-*]\s*/.test(l));
    const employer = rows[0] || '';
    const title = rows[1] || '';
    const dateLine = rows[2] || '';
    let startDate = '';
    let endDate = '';
    const dateMatch = dateLine.match(/(.+?)\s+-\s+(.+)/);
    if (dateMatch) {
      startDate = dateMatch[1].trim();
      endDate = dateMatch[2].trim();
    } else {
      startDate = dateLine.trim();
    }

    if (employer || title || bullets.length) {
      entries.push({
        employer,
        title,
        startDate,
        endDate,
        bullets: bullets.slice(0, 6),
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return entries;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function buildStructuredCvObject(inputText) {
  const lines = toLines(inputText);
  const sections = splitSections(lines);

  const fullName = sections.preface[0] || 'Candidate Name';
  const professionalTitle = sections.preface[1] && !/@|\+?\d/.test(sections.preface[1]) ? sections.preface[1] : '';
  const contactLines = sections.preface.slice(professionalTitle ? 2 : 1);

  const skills = dedupe(
    sections.skills.flatMap((line) => line.split(/[|,]/g)).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean),
  );

  const simpleList = (arr) => dedupe(arr.map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean));

  return {
    fullName,
    professionalTitle,
    contact: parseContact(contactLines),
    summary: sections.summary.join(' ').trim(),
    skills,
    experience: parseExperience(sections.experience),
    education: simpleList(sections.education),
    certifications: simpleList(sections.certifications),
    languages: simpleList(sections.languages),
    additionalInfo: simpleList(sections.additionalInfo),
  };
}

function validateCv(cv) {
  if (!cv.fullName || !cv.professionalTitle) {
    throw new Error('CV export validation failed: missing name/title at top.');
  }

  if (!cv.experience.length) {
    throw new Error('CV export validation failed: experience section is not structured into entries.');
  }

  const bodyText = [
    cv.summary,
    ...cv.skills,
    ...cv.education,
    ...cv.certifications,
    ...cv.languages,
    ...cv.additionalInfo,
    ...cv.experience.flatMap((e) => [e.employer, e.title, e.startDate, e.endDate, ...e.bullets]),
  ].join(' ');

  if (/\bpage\s+\d+(\s+of\s+\d+)?\b/i.test(bodyText)) {
    throw new Error('CV export validation failed: page marker artifact found in body.');
  }
  if (/\b[A-Za-z]{1}\s+[A-Za-z]{1}\b/.test(bodyText)) {
    throw new Error('CV export validation failed: malformed spacing detected in words.');
  }
}

function wrapLine(text, fontSize, width) {
  const maxChars = Math.max(10, Math.floor(width / (fontSize * 0.52)));
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (candidate.length > maxChars) {
      lines.push(current);
      current = words[i];
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function buildRenderBlocks(cv) {
  const blocks = [];
  const contactLine = [cv.contact.phone, cv.contact.email, cv.contact.location, cv.contact.nationality, cv.contact.linkedin].filter(Boolean).join(' | ');

  blocks.push({ type: 'line', text: cv.fullName, font: 'F2', size: 20, after: 6 });
  blocks.push({ type: 'line', text: cv.professionalTitle, font: 'F2', size: 12, after: 6 });
  if (contactLine) blocks.push({ type: 'line', text: contactLine, font: 'F1', size: 10, after: 10 });

  const addHeading = (title) => blocks.push({ type: 'heading', text: title, font: 'F2', size: 11, before: 10, after: 5, keepWithNext: true });

  if (cv.summary) {
    addHeading('PROFESSIONAL SUMMARY');
    blocks.push({ type: 'paragraph', text: cv.summary, font: 'F1', size: 10.5, after: 8 });
  }
  if (cv.skills.length) {
    addHeading('CORE SKILLS');
    blocks.push({ type: 'paragraph', text: cv.skills.join(' | '), font: 'F1', size: 10.5, after: 8 });
  }

  addHeading('PROFESSIONAL EXPERIENCE');
  for (const role of cv.experience) {
    blocks.push({ type: 'groupStart' });
    blocks.push({ type: 'line', text: role.employer, font: 'F2', size: 11, after: 2 });
    if (role.title) blocks.push({ type: 'line', text: role.title, font: 'F1', size: 10.5, after: 1 });
    const dateText = [role.startDate, role.endDate].filter(Boolean).join(' - ');
    if (dateText) blocks.push({ type: 'line', text: dateText, font: 'F1', size: 9.5, after: 3 });
    role.bullets.slice(0, 6).forEach((b) => blocks.push({ type: 'bullet', text: b, font: 'F1', size: 10, after: 1 }));
    blocks.push({ type: 'spacer', height: 5 });
    blocks.push({ type: 'groupEnd' });
  }

  const optionals = [
    ['EDUCATION', cv.education],
    ['CERTIFICATIONS / TRAINING', cv.certifications],
    ['LANGUAGES', cv.languages],
    ['ADDITIONAL INFORMATION', cv.additionalInfo],
  ];

  optionals.forEach(([title, list]) => {
    if (!list.length) return;
    addHeading(title);
    list.forEach((item) => blocks.push({ type: 'bullet', text: item, font: 'F1', size: 10, after: 1 }));
  });

  return blocks;
}

function blockHeight(block) {
  if (block.type === 'spacer') return block.height || 0;
  const indent = block.type === 'bullet' ? 14 : 0;
  const lines = wrapLine(block.text || '', block.size || 10, CONTENT_WIDTH - indent);
  const lh = Math.ceil((block.size || 10) * 1.45);
  return (block.before || 0) + lines.length * lh + (block.after || 0);
}

function renderPages(blocks) {
  const pages = [];
  let commands = [];
  let y = A4_HEIGHT - MARGIN;
  const minY = MARGIN;

  const pushPage = () => {
    if (!commands.length) return;
    pages.push({ stream: `BT\n${commands.join('\n')}\nET` });
    commands = [];
    y = A4_HEIGHT - MARGIN;
  };

  const renderBlock = (block) => {
    if (block.type === 'spacer') {
      y -= block.height || 0;
      return;
    }
    y -= block.before || 0;
    const indent = block.type === 'bullet' ? 14 : 0;
    const lines = wrapLine(block.text || '', block.size || 10, CONTENT_WIDTH - indent);
    const lh = Math.ceil((block.size || 10) * 1.45);

    for (let i = 0; i < lines.length; i += 1) {
      if (y - lh < minY) pushPage();
      if (block.type === 'bullet' && i === 0) {
        commands.push(`1 0 0 1 ${MARGIN + 3} ${y} Tm\n/F1 10 Tf\n(${encodePdfText('-')}) Tj`);
      }
      commands.push(`1 0 0 1 ${MARGIN + indent} ${y} Tm\n/${block.font || 'F1'} ${block.size || 10} Tf\n(${encodePdfText(lines[i])}) Tj`);
      y -= lh;
    }
    y -= block.after || 0;
  };

  let group = null;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === 'groupStart') {
      group = [];
      continue;
    }
    if (block.type === 'groupEnd') {
      const h = group.reduce((sum, b) => sum + blockHeight(b), 0);
      if (y - h < minY) pushPage();
      group.forEach(renderBlock);
      group = null;
      continue;
    }
    if (group) {
      group.push(block);
      continue;
    }

    if (block.keepWithNext && blocks[i + 1]) {
      const needed = blockHeight(block) + blockHeight(blocks[i + 1]);
      if (y - needed < minY) pushPage();
    }

    if (y - blockHeight(block) < minY) pushPage();
    renderBlock(block);
  }

  pushPage();
  return pages;
}

function buildPdfFromPages(pages) {
  if (!pages.length) {
    pages = [{ stream: 'BT\n1 0 0 1 50 780 Tm\n/F1 10 Tf\n(CV generation unavailable.) Tj\nET' }];
  }

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj`,
  ];

  pages.forEach((page, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R /F2 ${4 + pages.length * 2} 0 R >> >> >>\nendobj`,
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(page.stream, 'latin1')} >>\nstream\n${page.stream}\nendstream\nendobj`,
    );
  });

  const f1 = 3 + pages.length * 2;
  const f2 = 4 + pages.length * 2;
  objects.push(
    `${f1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `${f2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
  );

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${obj}\n`;
  }

  const start = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function buildPdfBuffer(text) {
  const cv = buildStructuredCvObject(text);
  validateCv(cv);
  const blocks = buildRenderBlocks(cv);
  const pages = renderPages(blocks);
  if (!pages.every((p) => /\(.+\) Tj/.test(p.stream))) {
    throw new Error('CV export validation failed: empty page detected.');
  }
  return buildPdfFromPages(pages);
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
