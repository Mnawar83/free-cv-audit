const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const BODY_FONT_SIZE = 10;
const NAME_FONT_SIZE = 16;
const HEADING_FONT_SIZE = 11;
const BULLET_INDENT = 16;
const LINE_HEIGHT_MULTIPLIER = 1.45;
const ACCENT_COLOR = '0.153 0.376 0.678'; // professional blue (RGB 39 96 173)

const SECTION_ORDER = [
  'professionalSummary',
  'coreCompetencies',
  'professionalExperience',
  'education',
  'technicalSkills',
  'certifications',
  'languages',
];

const SECTION_TITLES = {
  professionalSummary: 'PROFESSIONAL SUMMARY',
  coreCompetencies: 'CORE COMPETENCIES',
  professionalExperience: 'PROFESSIONAL EXPERIENCE',
  education: 'EDUCATION',
  technicalSkills: 'TECHNICAL SKILLS',
  certifications: 'CERTIFICATIONS / TRAINING',
  languages: 'LANGUAGES',
};

const SECTION_HEADING_ALIASES = {
  'professional summary': 'professionalSummary',
  summary: 'professionalSummary',
  profile: 'professionalSummary',
  'core competencies': 'coreCompetencies',
  competencies: 'coreCompetencies',
  'core skills': 'coreCompetencies',
  'professional experience': 'professionalExperience',
  experience: 'professionalExperience',
  'employment history': 'professionalExperience',
  education: 'education',
  'technical skills': 'technicalSkills',
  skills: 'technicalSkills',
  certifications: 'certifications',
  training: 'certifications',
  'certifications / training': 'certifications',
  languages: 'languages',
  'additional information': 'languages',
};

const PAGE_ARTIFACT_PATTERN = /^(?:page\s+\d+(?:\s+of\s+\d+)?|p\.?\s*\d+\s*(?:\/|of)\s*\d+)$/i;

const FORBIDDEN_PHRASES = [
  'candidate name',
  'your name',
  'full name',
  'first name',
  'last name',
  'firstname lastname',
  'professional title',
  'recent professional experience',
  'delivered responsibilities aligned with role requirements',
  'results-driven professional with experience delivering measurable outcomes, improving processes, and supporting cross-functional goals',
  'english: professional working proficiency',
  'process improvement | stakeholder communication | problem solving',
  '[your',
  '[insert',
  '[add',
  'lorem ipsum',
  'job title here',
  'company name here',
  'city, country',
  'month year - month year',
  'xx years',
];

function sanitizePdfText(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2000-\u200D\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uFFFD]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—―]/g, '-')
    .replace(/[•●▪◦]/g, '-')
    .replace(/…/g, '...')
    .replace(/\*\*/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function transliterateToAscii(text) {
  return String(text || '')
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

function normalizeLine(line) {
  return String(line || '')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isPageArtifact(line) {
  return PAGE_ARTIFACT_PATTERN.test(String(line || '').trim());
}

function containsCorruption(text) {
  const value = String(text || '');
  return /\uFFFD|[\u0000-\u001F\u007F]/.test(value);
}

function containsForbiddenPhrase(text) {
  const lower = String(text || '').toLowerCase().trim();
  return FORBIDDEN_PHRASES.some((phrase) => lower.includes(phrase));
}

function toLines(rawText) {
  return sanitizePdfText(rawText)
    .split('\n')
    .map(normalizeLine)
    .filter((line) => !line || !isPageArtifact(line))
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''));
}

function headingKey(line) {
  const clean = String(line || '')
    .replace(/:$/, '')
    .toLowerCase()
    .replace(/[^a-z/ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return SECTION_HEADING_ALIASES[clean] || null;
}

function parseHeader(prefaceLines) {
  const clean = prefaceLines.map((line) => normalizeLine(line)).filter(Boolean);
  const fullName = clean[0] || '';

  let professionalTitle = '';
  const contact = {
    location: '',
    phone: '',
    email: '',
  };

  const remaining = clean.slice(1);
  for (const line of remaining) {
    if (!contact.email && /\S+@\S+\.\S+/.test(line)) {
      contact.email = line;
      continue;
    }
    if (!contact.phone && /\+?\d[\d\s().-]{6,}/.test(line)) {
      contact.phone = line;
      continue;
    }
    if (!professionalTitle && /(manager|engineer|specialist|consultant|director|lead|developer|analyst|officer|coordinator|architect|executive|administrator)/i.test(line)) {
      professionalTitle = line;
      continue;
    }
    if (!contact.location) {
      contact.location = line;
      continue;
    }
    if (!professionalTitle) professionalTitle = line;
  }

  return {
    fullName,
    professionalTitle,
    contact,
  };
}

function splitSections(lines) {
  const sections = {
    preface: [],
    professionalSummary: [],
    coreCompetencies: [],
    professionalExperience: [],
    education: [],
    technicalSkills: [],
    certifications: [],
    languages: [],
  };
  let current = 'preface';

  for (const line of lines) {
    if (!line.trim()) {
      sections[current].push('');
      continue;
    }
    const candidateKey = headingKey(line);
    if (candidateKey) {
      current = candidateKey;
      continue;
    }
    sections[current].push(line);
  }

  return sections;
}

function dedupe(lines = []) {
  const seen = new Set();
  const out = [];
  for (const item of lines) {
    const normalized = normalizeLine(String(item || ''));
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function parseExperience(lines) {
  const entries = [];
  let currentRole = null;
  let sawBlankLine = false;

  const flushCurrentRole = () => {
    if (!currentRole) return;
    if (currentRole.company || currentRole.jobTitle || currentRole.dateRange || currentRole.bullets.length) {
      entries.push({
        company: currentRole.company,
        jobTitle: currentRole.jobTitle,
        dateRange: currentRole.dateRange,
        bullets: currentRole.bullets.slice(0, 8),
      });
    }
    currentRole = null;
  };

  const startRoleFromHeader = (line) => {
    if (/^[-*]\s+/.test(line)) return false;
    const parts = line.split('|').map((part) => normalizeLine(part)).filter(Boolean);
    if (!parts.length) return false;
    const looksLikeHeader = parts.length >= 2;
    if (!looksLikeHeader) return false;
    flushCurrentRole();
    const jobTitle = parts[0] || '';
    const company = parts[1] || '';
    const location = parts.length >= 4 ? parts[2] : '';
    const dateRange = parts.length >= 4 ? parts.slice(3).join(' | ') : (parts[2] || '');
    currentRole = {
      company: [company, location].filter(Boolean).join(' | '),
      jobTitle,
      dateRange,
      bullets: [],
    };
    return true;
  };

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      sawBlankLine = true;
      continue;
    }
    if (sawBlankLine && currentRole) {
      const startsBullet = /^[-*]\s*/.test(line);
      if (!startsBullet && currentRole.bullets.length) {
        flushCurrentRole();
      }
    }
    sawBlankLine = false;
    const bullet = line.match(/^[-*]\s*(.+)$/);
    if (bullet) {
      if (!currentRole) {
        currentRole = { company: '', jobTitle: '', dateRange: '', bullets: [] };
      }
      currentRole.bullets.push(bullet[1].trim());
      continue;
    }
    if (startRoleFromHeader(line)) {
      continue;
    }

    if (!currentRole) {
      currentRole = { company: '', jobTitle: '', dateRange: '', bullets: [] };
    }
    if (!currentRole.company) {
      currentRole.company = line;
      continue;
    }
    if (!currentRole.jobTitle) {
      currentRole.jobTitle = line;
      continue;
    }
    if (!currentRole.dateRange) {
      currentRole.dateRange = line;
      continue;
    }
    currentRole.bullets.push(line);
  }
  flushCurrentRole();

  return entries;
}

function parseEducation(lines) {
  const entries = [];
  let block = [];

  const flush = () => {
    const rows = block.map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    if (!rows.length) {
      block = [];
      return;
    }
    entries.push({
      degree: rows[0] || '',
      institution: rows[1] || '',
      dateRange: rows[2] || '',
    });
    block = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    block.push(line);
  }
  flush();

  return entries;
}

function normalizeSummary(summaryText) {
  const clean = normalizeLine(summaryText);
  if (!clean) return '';
  const withoutObjective = clean.replace(/\bobjective\b\s*:?/gi, '').trim();
  return withoutObjective;
}

function buildStructuredCvObject(inputText) {
  const lines = toLines(inputText);
  const sections = splitSections(lines);
  const header = parseHeader(sections.preface);

  return {
    ...header,
    professionalSummary: normalizeSummary(sections.professionalSummary.join(' ')),
    coreCompetencies: dedupe(sections.coreCompetencies.flatMap((line) => line.split(/[|,]/g))),
    professionalExperience: parseExperience(sections.professionalExperience),
    education: parseEducation(sections.education),
    technicalSkills: dedupe(sections.technicalSkills.flatMap((line) => line.split(/[|,]/g))),
    certifications: dedupe(sections.certifications),
    languages: dedupe(sections.languages),
  };
}

function validateAndAutoCorrect(cv) {
  const corrected = { ...cv };

  if (!corrected.fullName || containsCorruption(corrected.fullName) || containsForbiddenPhrase(corrected.fullName)) {
    corrected.fullName = '';
  }
  corrected.fullName = normalizeLine(corrected.fullName);

  corrected.professionalTitle = normalizeLine(corrected.professionalTitle || '');
  if (containsForbiddenPhrase(corrected.professionalTitle)) {
    corrected.professionalTitle = '';
  }

  corrected.contact = corrected.contact || {};
  corrected.contact.location = normalizeLine(corrected.contact.location || '');
  corrected.contact.phone = normalizeLine(corrected.contact.phone || '');
  corrected.contact.email = normalizeLine(corrected.contact.email || '');

  corrected.professionalSummary = normalizeSummary(corrected.professionalSummary || '');
  if (containsForbiddenPhrase(corrected.professionalSummary)) {
    corrected.professionalSummary = '';
  }

  const filterForbidden = (items) => dedupe(items || []).filter((item) => !containsForbiddenPhrase(item));
  corrected.coreCompetencies = filterForbidden(corrected.coreCompetencies);
  corrected.technicalSkills = filterForbidden(corrected.technicalSkills);
  corrected.certifications = filterForbidden(corrected.certifications);
  corrected.languages = filterForbidden(corrected.languages);

  corrected.professionalExperience = (corrected.professionalExperience || []).map((role) => ({
    company: normalizeLine(role?.company || ''),
    jobTitle: normalizeLine(role?.jobTitle || ''),
    dateRange: normalizeLine(role?.dateRange || ''),
    bullets: dedupe((role?.bullets || []).map((item) => item.replace(/^[-*]\s*/, '').trim()))
      .filter((b) => !containsForbiddenPhrase(b))
      .slice(0, 8),
  })).filter((role) => {
    if (containsForbiddenPhrase(role.company) || containsForbiddenPhrase(role.jobTitle)) return false;
    return role.company || role.jobTitle || role.dateRange || role.bullets.length;
  });

  corrected.education = (corrected.education || []).map((item) => ({
    degree: normalizeLine(item?.degree || ''),
    institution: normalizeLine(item?.institution || ''),
    dateRange: normalizeLine(item?.dateRange || ''),
  })).filter((item) => {
    if (containsForbiddenPhrase(item.degree)) return false;
    return item.degree || item.institution || item.dateRange;
  });

  if (corrected.professionalSummary) {
    corrected.professionalSummary = limitSummaryToFiveLines(corrected.professionalSummary);
  }

  const bodyText = [
    corrected.professionalSummary,
    ...corrected.coreCompetencies,
    ...corrected.technicalSkills,
    ...corrected.certifications,
    ...corrected.languages,
    ...corrected.professionalExperience.flatMap((role) => [role.company, role.jobTitle, role.dateRange, ...role.bullets]),
  ].join(' ');

  if (containsCorruption(bodyText) || /\bpage\s+\d+(?:\s+of\s+\d+)?\b/i.test(bodyText)) {
    throw new Error('CV export validation failed: malformed encoding or page artifacts detected after sanitization.');
  }

  return corrected;
}

function wrapLine(text, fontSize, width) {
  const clean = normalizeLine(text);
  // Improved character width estimation using average Helvetica character width.
  // Helvetica average char width is ~0.50em; use 0.48 for regular and account for
  // narrow chars (i,l,t ~0.28em) and wide chars (m,w ~0.72em) via averaging.
  const avgCharWidth = fontSize * 0.48;
  const maxChars = Math.max(12, Math.floor(width / avgCharWidth));
  const words = clean.split(/\s+/).filter(Boolean);
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

function lineHeight(size) {
  return Math.ceil(size * LINE_HEIGHT_MULTIPLIER);
}


function limitSummaryToFiveLines(summary) {
  const lines = wrapLine(summary, BODY_FONT_SIZE, CONTENT_WIDTH);
  if (lines.length <= 5) return lines.join(' ');
  return lines.slice(0, 5).join(' ');
}

function buildRenderBlocks(cv) {
  const blocks = [];
  const headingStyle = { font: 'F2', size: HEADING_FONT_SIZE };

  const addHeading = (key) => {
    blocks.push({ type: 'rule', before: 10, after: 0 });
    blocks.push({ type: 'heading', text: SECTION_TITLES[key], ...headingStyle, before: 6, after: 5, keepWithNext: true });
  };

  const addCentered = (text, size, bold = false, after = 4) => {
    if (!text) return;
    blocks.push({ type: 'line', text, font: bold ? 'F2' : 'F1', size, align: 'center', after });
  };

  const contactParts = [cv.contact.location, cv.contact.phone, cv.contact.email].filter(Boolean);
  const contactLine = contactParts.join('  |  ');

  if (cv.fullName) {
    addCentered(cv.fullName, NAME_FONT_SIZE, true, 3);
  }
  if (cv.professionalTitle) {
    addCentered(cv.professionalTitle, BODY_FONT_SIZE + 1, false, 3);
  }
  if (contactLine) {
    addCentered(contactLine, BODY_FONT_SIZE - 0.5, false, 4);
  }
  blocks.push({ type: 'accentRule', before: 4, after: 6 });

  if (cv.professionalSummary) {
    addHeading('professionalSummary');
    blocks.push({ type: 'paragraph', text: cv.professionalSummary, font: 'F1', size: BODY_FONT_SIZE, after: 6 });
  }

  if (cv.coreCompetencies.length) {
    addHeading('coreCompetencies');
    blocks.push({ type: 'paragraph', text: cv.coreCompetencies.join('  |  '), font: 'F1', size: BODY_FONT_SIZE, after: 5 });
  }

  if (cv.professionalExperience.length) {
    addHeading('professionalExperience');
    cv.professionalExperience.forEach((role, roleIndex) => {
      blocks.push({ type: 'groupStart' });
      if (roleIndex > 0) blocks.push({ type: 'spacer', height: 3 });
      if (role.company) blocks.push({ type: 'line', text: role.company, font: 'F2', size: BODY_FONT_SIZE + 0.5, after: 1 });
      if (role.jobTitle) blocks.push({ type: 'line', text: role.jobTitle, font: 'F1', size: BODY_FONT_SIZE, after: 1 });
      if (role.dateRange) blocks.push({ type: 'line', text: role.dateRange, font: 'F1', size: BODY_FONT_SIZE - 0.5, after: 3 });
      (role.bullets || []).forEach((bullet) => blocks.push({ type: 'bullet', text: bullet, font: 'F1', size: BODY_FONT_SIZE, after: 2 }));
      blocks.push({ type: 'spacer', height: 2 });
      blocks.push({ type: 'groupEnd' });
    });
  }

  if (cv.education.length) {
    addHeading('education');
    cv.education.forEach((item) => {
      if (item.degree) blocks.push({ type: 'line', text: item.degree, font: 'F2', size: BODY_FONT_SIZE, after: 1 });
      if (item.institution) blocks.push({ type: 'line', text: item.institution, font: 'F1', size: BODY_FONT_SIZE, after: 1 });
      if (item.dateRange) blocks.push({ type: 'line', text: item.dateRange, font: 'F1', size: BODY_FONT_SIZE - 0.5, after: 4 });
    });
  }

  if (cv.technicalSkills.length) {
    addHeading('technicalSkills');
    blocks.push({ type: 'paragraph', text: cv.technicalSkills.join('  |  '), font: 'F1', size: BODY_FONT_SIZE, after: 4 });
  }

  if (cv.certifications.length) {
    addHeading('certifications');
    cv.certifications.forEach((cert) => blocks.push({ type: 'bullet', text: cert, font: 'F1', size: BODY_FONT_SIZE, after: 2 }));
  }

  if (cv.languages.length) {
    addHeading('languages');
    blocks.push({ type: 'paragraph', text: cv.languages.join('  |  '), font: 'F1', size: BODY_FONT_SIZE, after: 0 });
  }

  return blocks;
}

function blockHeight(block) {
  if (block.type === 'spacer') return block.height || 0;
  if (block.type === 'rule' || block.type === 'accentRule') return (block.before || 0) + 1 + (block.after || 0);
  const indent = block.type === 'bullet' ? BULLET_INDENT : 0;
  const lines = wrapLine(block.text || '', block.size || BODY_FONT_SIZE, CONTENT_WIDTH - indent);
  return (block.before || 0) + lines.length * lineHeight(block.size || BODY_FONT_SIZE) + (block.after || 0);
}

function estimateCenteredX(text, size) {
  const width = String(text || '').length * (size * 0.5);
  return Math.max(MARGIN, Math.min(A4_WIDTH - MARGIN, (A4_WIDTH - width) / 2));
}

function estimateRightX(text, size) {
  const width = String(text || '').length * (size * 0.5);
  return Math.max(MARGIN, A4_WIDTH - MARGIN - width);
}

function renderPages(blocks) {
  const pages = [];
  let commands = [];
  let graphicsCommands = [];
  let y = A4_HEIGHT - MARGIN;
  const minY = MARGIN;

  const pushPage = () => {
    if (!commands.length && !graphicsCommands.length) return;
    let stream = '';
    if (graphicsCommands.length) {
      stream += graphicsCommands.join('\n') + '\n';
    }
    stream += `BT\n${commands.join('\n')}\nET`;
    pages.push({ stream });
    commands = [];
    graphicsCommands = [];
    y = A4_HEIGHT - MARGIN;
  };

  const renderBlock = (block) => {
    if (block.type === 'spacer') {
      y -= block.height || 0;
      return;
    }

    if (block.type === 'rule') {
      y -= block.before || 0;
      graphicsCommands.push(`q\n0.78 0.8 0.82 RG\n0.5 w\n${MARGIN} ${y} m ${A4_WIDTH - MARGIN} ${y} l S\nQ`);
      y -= 1 + (block.after || 0);
      return;
    }

    if (block.type === 'accentRule') {
      y -= block.before || 0;
      graphicsCommands.push(`q\n${ACCENT_COLOR} RG\n1.5 w\n${MARGIN} ${y} m ${A4_WIDTH - MARGIN} ${y} l S\nQ`);
      y -= 1.5 + (block.after || 0);
      return;
    }

    y -= block.before || 0;
    const indent = block.type === 'bullet' ? BULLET_INDENT : 0;
    const wrapped = wrapLine(block.text || '', block.size || BODY_FONT_SIZE, CONTENT_WIDTH - indent);
    const lh = lineHeight(block.size || BODY_FONT_SIZE);

    wrapped.forEach((line, index) => {
      if (y - lh < minY) pushPage();
      let x = MARGIN + indent;
      if (block.align === 'center') {
        x = estimateCenteredX(line, block.size || BODY_FONT_SIZE);
      } else if (block.align === 'right') {
        x = estimateRightX(line, block.size || BODY_FONT_SIZE);
      }
      if (block.type === 'bullet' && index === 0) {
        // Render bullet marker aligned with text
        graphicsCommands.push(`q\n0.25 0.25 0.25 rg\n${MARGIN + 4} ${y - 3.5} 3 3 re f\nQ`);
      }
      // Use accent color for headings
      if (block.type === 'heading') {
        commands.push(`${ACCENT_COLOR} rg`);
      }
      commands.push(`1 0 0 1 ${x} ${y} Tm\n/${block.font || 'F1'} ${block.size || BODY_FONT_SIZE} Tf\n(${encodePdfText(line)}) Tj`);
      if (block.type === 'heading') {
        commands.push('0 0 0 rg');
      }
      y -= lh;
    });

    y -= block.after || 0;
  };

  let group = null;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type === 'groupStart') {
      group = [];
      continue;
    }
    if (block.type === 'groupEnd') {
      const totalHeight = group.reduce((sum, item) => sum + blockHeight(item), 0);
      if (y - totalHeight < minY) pushPage();
      group.forEach(renderBlock);
      group = null;
      continue;
    }
    if (group) {
      group.push(block);
      continue;
    }

    if (block.keepWithNext && blocks[index + 1]) {
      const needed = blockHeight(block) + blockHeight(blocks[index + 1]);
      if (y - needed < minY) pushPage();
    }

    if (y - blockHeight(block) < minY) pushPage();
    renderBlock(block);
  }

  pushPage();
  return pages;
}

function buildPdfFromPages(pages) {
  const safePages = pages.length
    ? pages
    : [{ stream: 'BT\n1 0 0 1 50 780 Tm\n/F1 10 Tf\n(CV generation unavailable.) Tj\nET' }];

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${safePages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${safePages.length} >>\nendobj`,
  ];

  safePages.forEach((page, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${3 + safePages.length * 2} 0 R /F2 ${4 + safePages.length * 2} 0 R >> >> >>\nendobj`,
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(page.stream, 'latin1')} >>\nstream\n${page.stream}\nendstream\nendobj`,
    );
  });

  const f1 = 3 + safePages.length * 2;
  const f2 = 4 + safePages.length * 2;
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

  const startXRef = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXRef}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function validateRenderBlocks(blocks) {
  const seenHeadingTitles = new Set();
  let duplicateHeadingDetected = false;
  let nameBlock = null;
  let hasBullet = false;
  let hasContent = false;

  blocks.forEach((block) => {
    if (!nameBlock && block.type === 'line' && block.font === 'F2' && block.align === 'center') {
      nameBlock = block;
    }
    const text = String(block.text || '');
    if (text) {
      hasContent = true;
      if (containsCorruption(text) || /page\s+\d+(?:\s+of\s+\d+)?/i.test(text)) {
        throw new Error('CV export validation failed: malformed characters or page artifacts detected in rendered content.');
      }
      if (containsForbiddenPhrase(text)) {
        throw new Error(`CV export validation failed: placeholder text detected in rendered content: "${text.substring(0, 60)}".`);
      }
    }
    if (block.type === 'bullet') {
      hasBullet = true;
      if (!text.trim()) {
        throw new Error('CV export validation failed: empty bullet detected.');
      }
    }
    if (block.type === 'heading') {
      if (seenHeadingTitles.has(block.text)) {
        duplicateHeadingDetected = true;
      }
      seenHeadingTitles.add(block.text);
      if (block.font !== 'F2') {
        throw new Error('CV export validation failed: section heading is not bold.');
      }
    }
  });

  if (!hasContent) {
    throw new Error('CV export validation failed: no content found in CV.');
  }

  if (nameBlock && (nameBlock.font !== 'F2' || Number(nameBlock.size) !== NAME_FONT_SIZE)) {
    throw new Error('CV export validation failed: applicant name must be bold and prominently sized.');
  }

  if (duplicateHeadingDetected) {
    throw new Error('CV export validation failed: duplicate section headings detected.');
  }
}


function mapStructuredCvForPdf(structuredCv) {
  const source = structuredCv && typeof structuredCv === 'object' ? structuredCv : {};
  const contact = source.contact && typeof source.contact === 'object' ? source.contact : {};

  return {
    fullName: source.fullName || '',
    professionalTitle: source.professionalTitle || '',
    contact: {
      location: contact.location || '',
      phone: contact.phone || '',
      email: contact.email || '',
    },
    professionalSummary: source.summary || '',
    coreCompetencies: Array.isArray(source.skills) ? source.skills : [],
    professionalExperience: (Array.isArray(source.experience) ? source.experience : []).map((role) => ({
      company: role?.company || '',
      jobTitle: role?.jobTitle || '',
      dateRange: role?.dates || '',
      bullets: Array.isArray(role?.bullets) ? role.bullets : [],
    })),
    education: (Array.isArray(source.education) ? source.education : []).map((item) => ({
      degree: item?.degree || '',
      institution: item?.institution || '',
      dateRange: item?.date || '',
    })),
    technicalSkills: Array.isArray(source.technicalSkills) ? source.technicalSkills : [],
    certifications: Array.isArray(source.certifications) ? source.certifications : [],
    languages: Array.isArray(source.languages) ? source.languages : [],
  };
}

function buildPdfBufferFromStructuredCv(structuredCv) {
  const mapped = mapStructuredCvForPdf(structuredCv);
  const validated = validateAndAutoCorrect(mapped);
  const blocks = buildRenderBlocks(validated);
  validateRenderBlocks(blocks);
  const pages = renderPages(blocks);
  if (!pages.length || pages.some((page) => !/\(.+\) Tj/.test(page.stream) && !/\bre\b/.test(page.stream))) {
    throw new Error('CV export validation failed: empty pages detected.');
  }
  return buildPdfFromPages(pages);
}

function normalizeToCvTemplateText(inputText) {
  const structured = buildStructuredCvObject(inputText);
  const cv = validateAndAutoCorrect(structured);
  const lines = [];

  if (cv.fullName) lines.push(cv.fullName);
  if (cv.contact.location) lines.push(cv.contact.location);
  if (cv.contact.phone) lines.push(cv.contact.phone);
  if (cv.contact.email) lines.push(cv.contact.email);
  if (cv.professionalTitle) lines.push(cv.professionalTitle);

  if (cv.professionalSummary) {
    lines.push('', SECTION_TITLES.professionalSummary, cv.professionalSummary);
  }

  if (cv.coreCompetencies.length) {
    lines.push('', SECTION_TITLES.coreCompetencies);
    cv.coreCompetencies.forEach((item) => lines.push(`- ${item}`));
  }

  if (cv.professionalExperience.length) {
    lines.push('', SECTION_TITLES.professionalExperience);
    cv.professionalExperience.forEach((role) => {
      if (role.company) lines.push(role.company);
      if (role.jobTitle) lines.push(role.jobTitle);
      if (role.dateRange) lines.push(role.dateRange);
      (role.bullets || []).forEach((bullet) => lines.push(`- ${bullet}`));
      lines.push('');
    });
  }

  if (cv.education.length) {
    lines.push(SECTION_TITLES.education);
    cv.education.forEach((item) => {
      if (item.degree) lines.push(item.degree);
      if (item.institution) lines.push(item.institution);
      if (item.dateRange) lines.push(item.dateRange);
      lines.push('');
    });
  }

  if (cv.technicalSkills.length) {
    lines.push(SECTION_TITLES.technicalSkills, ...cv.technicalSkills.map((skill) => `- ${skill}`), '');
  }
  if (cv.certifications.length) {
    lines.push(SECTION_TITLES.certifications, ...cv.certifications.map((cert) => `- ${cert}`), '');
  }
  if (cv.languages.length) {
    lines.push(SECTION_TITLES.languages, ...cv.languages.map((language) => `- ${language}`));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPdfBuffer(text) {
  const structured = buildStructuredCvObject(text);
  const validated = validateAndAutoCorrect(structured);
  const blocks = buildRenderBlocks(validated);
  validateRenderBlocks(blocks);
  const pages = renderPages(blocks);
  if (!pages.length || pages.some((page) => !/\(.+\) Tj/.test(page.stream) && !/\bre\b/.test(page.stream))) {
    throw new Error('CV export validation failed: empty pages detected.');
  }
  return buildPdfFromPages(pages);
}

function buildPdfBufferLenient(rawText) {
  const sanitized = sanitizePdfText(rawText);
  const cleanedLines = sanitized
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter((line) => line && !isPageArtifact(line))
    .filter((line) => !containsCorruption(line))
    .filter((line) => !containsForbiddenPhrase(line));
  const safeLines = cleanedLines.filter((line) => !SECTION_HEADING_ALIASES[line.toLowerCase()]);

  const findLine = (predicate) => safeLines.find((line) => predicate(line)) || '';
  const email = findLine((line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line));
  const phone = findLine((line) => /(?:\+?\d[\d\s().-]{6,}\d)/.test(line));
  const location = findLine((line) => /,/.test(line) && !line.includes('@') && !/^\d/.test(line));

  const headingSet = new Set(Object.keys(SECTION_HEADING_ALIASES));
  const isLikelyHeading = (line) => headingSet.has(String(line || '').toLowerCase().trim());
  const nameCandidate = findLine((line) => /^[A-Za-z][A-Za-z .'-]{2,}$/.test(line) && !isLikelyHeading(line));
  const titleCandidate = safeLines.find((line) => (
    line !== nameCandidate
    && !line.includes('@')
    && !/(?:\+?\d[\d\s().-]{6,}\d)/.test(line)
    && !isLikelyHeading(line)
    && line.length <= 72
  )) || '';

  const sectionBuckets = {
    summary: [],
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    languages: [],
  };
  let activeBucket = 'summary';

  cleanedLines.forEach((line) => {
    const alias = SECTION_HEADING_ALIASES[String(line).toLowerCase().trim()];
    if (alias) {
      if (alias === 'coreCompetencies' || alias === 'technicalSkills') activeBucket = 'skills';
      else if (alias === 'professionalExperience') activeBucket = 'experience';
      else if (alias === 'education') activeBucket = 'education';
      else if (alias === 'certifications') activeBucket = 'certifications';
      else if (alias === 'languages') activeBucket = 'languages';
      else activeBucket = 'summary';
      return;
    }
    if (line === nameCandidate || line === titleCandidate || line === email || line === phone || line === location) {
      return;
    }
    sectionBuckets[activeBucket].push(line.replace(/^[-*•]\s*/, '').trim());
  });

  const listFromLines = (lines, limit = 8) => lines.filter(Boolean).slice(0, limit);
  const summaryText = listFromLines(sectionBuckets.summary, 3).join(' ').trim()
    || 'Experienced professional with a strong track record of delivering results.';
  const skillItems = listFromLines(sectionBuckets.skills, 10)
    .flatMap((line) => line.split(/[|,]/g).map((item) => item.trim()).filter(Boolean))
    .slice(0, 10);
  const experienceBullets = listFromLines(sectionBuckets.experience.length ? sectionBuckets.experience : safeLines, 10);
  const educationItems = listFromLines(sectionBuckets.education, 3);
  const certificationItems = listFromLines(sectionBuckets.certifications, 5);
  const languageItems = listFromLines(sectionBuckets.languages, 5);

  const lenientStructuredCv = {
    fullName: nameCandidate || 'CV Candidate',
    professionalTitle: titleCandidate,
    contact: {
      location,
      phone,
      email,
    },
    summary: summaryText,
    skills: skillItems,
    experience: [{
      company: '',
      jobTitle: '',
      location: '',
      dates: '',
      bullets: experienceBullets.length ? experienceBullets : ['Delivered measurable outcomes in cross-functional environments.'],
    }],
    education: educationItems.length
      ? educationItems.map((line) => ({ degree: line, institution: '', date: '' }))
      : [],
    certifications: certificationItems,
    languages: languageItems,
    technicalSkills: [],
  };

  try {
    return buildPdfBufferFromStructuredCv(lenientStructuredCv);
  } catch (error) {
    const minimalTemplateText = [
      lenientStructuredCv.fullName,
      '',
      SECTION_TITLES.professionalSummary,
      lenientStructuredCv.summary,
      '',
      SECTION_TITLES.professionalExperience,
      ...lenientStructuredCv.experience[0].bullets.map((bullet) => `- ${bullet}`),
    ].join('\n');
    return buildPdfBuffer(minimalTemplateText);
  }
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

module.exports = {
  buildPdfBuffer,
  buildPdfBufferLenient,
  buildPdfBufferFromStructuredCv,
  pdfResponse,
  normalizeToCvTemplateText,
  __test: {
    parseExperience,
    buildStructuredCvObject,
    validateAndAutoCorrect,
    buildRenderBlocks,
    validateRenderBlocks,
    containsForbiddenPhrase,
    FORBIDDEN_PHRASES,
    mapStructuredCvForPdf,
  },
};
