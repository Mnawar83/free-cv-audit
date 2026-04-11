const SECTION_TITLES = {
  summary: 'PROFESSIONAL SUMMARY',
  skills: 'CORE SKILLS',
  experience: 'PROFESSIONAL EXPERIENCE',
  education: 'EDUCATION',
  certifications: 'CERTIFICATIONS',
  languages: 'LANGUAGES',
};

const PLACEHOLDER_PATTERNS = [
  /candidate name/i,
  /professional title/i,
  /company name here/i,
  /job title here/i,
  /lorem ipsum/i,
];

function asString(value) {
  return String(value || '').trim();
}

function cleanLine(value) {
  return asString(value).replace(/\s+/g, ' ').trim();
}

function hasPlaceholder(value) {
  const text = asString(value);
  if (!text) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function cleanList(input, limit = 12) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const clean = cleanLine(item);
    if (!clean) continue;
    if (hasPlaceholder(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeStructuredCv(input) {
  const source = input && typeof input === 'object' ? input : {};
  const contact = source.contact && typeof source.contact === 'object' ? source.contact : {};

  const normalized = {
    fullName: cleanLine(source.fullName),
    professionalTitle: cleanLine(source.professionalTitle),
    contact: {
      location: cleanLine(contact.location),
      phone: cleanLine(contact.phone),
      email: cleanLine(contact.email),
    },
    summary: cleanLine(source.summary),
    skills: cleanList(source.skills, 24),
    experience: [],
    education: [],
    certifications: cleanList(source.certifications, 12),
    languages: cleanList(source.languages, 12),
  };

  const experience = Array.isArray(source.experience) ? source.experience : [];
  for (const role of experience.slice(0, 12)) {
    const item = role && typeof role === 'object' ? role : {};
    const normalizedRole = {
      jobTitle: cleanLine(item.jobTitle),
      company: cleanLine(item.company),
      location: cleanLine(item.location),
      dates: cleanLine(item.dates),
      bullets: cleanList(item.bullets, 8),
    };
    if (!normalizedRole.jobTitle && !normalizedRole.company && !normalizedRole.dates && !normalizedRole.bullets.length) {
      continue;
    }
    if (hasPlaceholder(normalizedRole.jobTitle) || hasPlaceholder(normalizedRole.company)) {
      continue;
    }
    normalized.experience.push(normalizedRole);
  }

  const education = Array.isArray(source.education) ? source.education : [];
  for (const entry of education.slice(0, 8)) {
    const item = entry && typeof entry === 'object' ? entry : {};
    const normalizedEntry = {
      degree: cleanLine(item.degree),
      institution: cleanLine(item.institution),
      date: cleanLine(item.date),
    };
    if (!normalizedEntry.degree && !normalizedEntry.institution && !normalizedEntry.date) continue;
    if (hasPlaceholder(normalizedEntry.degree) || hasPlaceholder(normalizedEntry.institution)) continue;
    normalized.education.push(normalizedEntry);
  }

  return normalized;
}

function isStructuredCvValid(cv) {
  if (!cv || typeof cv !== 'object') return false;
  if (!asString(cv.fullName)) return false;
  const hasSummary = Boolean(asString(cv.summary));
  const hasExperience = Array.isArray(cv.experience) && cv.experience.length > 0;
  const hasEducation = Array.isArray(cv.education) && cv.education.length > 0;
  if (!hasSummary && !hasExperience && !hasEducation) return false;
  return true;
}

function structuredCvToTemplateText(cv) {
  const lines = [];
  const contactParts = [cv.contact.location, cv.contact.phone, cv.contact.email].filter(Boolean);

  if (cv.fullName) lines.push(cv.fullName);
  if (cv.professionalTitle) lines.push(cv.professionalTitle);
  if (contactParts.length) lines.push(contactParts.join(' | '));

  if (cv.summary) {
    lines.push('', SECTION_TITLES.summary, cv.summary);
  }

  if (cv.skills.length) {
    lines.push('', SECTION_TITLES.skills);
    cv.skills.forEach((skill) => lines.push(`- ${skill}`));
  }

  if (cv.experience.length) {
    lines.push('', SECTION_TITLES.experience);
    cv.experience.forEach((role) => {
      const header = [role.jobTitle, role.company, role.location, role.dates].filter(Boolean).join(' | ');
      if (header) lines.push(header);
      role.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
      lines.push('');
    });
  }

  if (cv.education.length) {
    lines.push(SECTION_TITLES.education);
    cv.education.forEach((entry) => {
      const line = [entry.degree, entry.institution, entry.date].filter(Boolean).join(', ');
      if (line) lines.push(line);
    });
    lines.push('');
  }

  if (cv.certifications.length) {
    lines.push(SECTION_TITLES.certifications);
    cv.certifications.forEach((cert) => lines.push(`- ${cert}`));
    lines.push('');
  }

  if (cv.languages.length) {
    lines.push(SECTION_TITLES.languages);
    cv.languages.forEach((language) => lines.push(`- ${language}`));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tryExtractStructuredCv(rawText) {
  const text = asString(rawText);
  if (!text) return null;

  const candidates = [text];
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());

  const jsonObjectSlice = extractFirstJsonObject(text);
  if (jsonObjectSlice) candidates.push(jsonObjectSlice);

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (_error) {
      continue;
    }
    const normalized = normalizeStructuredCv(parsed);
    if (isStructuredCvValid(normalized)) return normalized;
  }

  return null;
}

function extractFirstJsonObject(text) {
  const value = asString(text);
  if (!value) return '';

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return '';
}

function maybeStructuredCvToTemplateText(value) {
  const normalized = normalizeStructuredCv(value);
  if (!isStructuredCvValid(normalized)) {
    return null;
  }
  return structuredCvToTemplateText(normalized);
}

module.exports = {
  normalizeStructuredCv,
  isStructuredCvValid,
  structuredCvToTemplateText,
  tryExtractStructuredCv,
  maybeStructuredCvToTemplateText,
};
