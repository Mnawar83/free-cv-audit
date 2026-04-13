const assert = require('assert');
const { buildPdfBuffer, buildPdfBufferFromStructuredCv, __test } = require('../netlify/functions/pdf-builder');

function decodePdf(buffer) {
  return buffer.toString('latin1');
}

async function run() {
  const sampleCv = [
    'Jane Doe',
    'Senior Product Manager',
    'Dubai, UAE | +971 50 123 4567 | jane@example.com',
    '',
    'Professional Summary',
    'Experienced product manager with 8+ years leading roadmap strategy, cross-functional delivery, and customer-centric product improvements across fintech and SaaS portfolios.',
    '',
    'Core Competencies',
    '- Product Strategy',
    '- Stakeholder Management',
    '- KPI Optimization',
    '',
    'Professional Experience',
    'Acme Corp',
    'Senior Product Manager',
    'Jan 2021 - Present',
    '- Led discovery and launch of core growth initiatives.',
    '- Improved conversion rates through experimentation.',
    '',
    'Education',
    'MBA, Business Administration',
    'State University',
    '2019',
    '',
    'Technical Skills',
    'SQL, Jira, Tableau',
    '',
    'Certifications',
    'PMP Certification',
    '',
    'Languages',
    'Arabic: Native',
    'English: Proficient',
  ].join('\n');

  const pdf = buildPdfBuffer(sampleCv);
  assert.ok(pdf.length > 1000, 'PDF should be generated.');

  const content = decodePdf(pdf);
  assert.ok(content.includes('/F2 16 Tf\n(Jane Doe) Tj'), 'Name should be bold and prominently sized.');
  assert.ok(content.includes('/F2 11 Tf\n(PROFESSIONAL SUMMARY) Tj'), 'Professional Summary heading should be bold.');
  assert.ok(content.includes('/F2 11 Tf\n(CORE COMPETENCIES) Tj'), 'Core Competencies heading should be bold.');
  assert.ok(content.includes('/F2 11 Tf\n(PROFESSIONAL EXPERIENCE) Tj'), 'Professional Experience heading should be bold.');
  assert.ok(!/Page\s+1\b/i.test(content), 'Page marker artifacts should not be rendered in content.');
  assert.ok(!content.includes('�'), 'Corrupted replacement symbols must be removed.');

  const corruptedInput = [
    'Jane Doe',
    'Page 1 of 2',
    'Professional Summary',
    'Objective: Build great products � with modern strategy.',
    'Core Competencies',
    'Roadmap, Discovery',
    'Professional Experience',
    'Foo Inc',
    'Manager',
    '2020 - 2024',
    '- Delivered outcomes',
    'Languages',
    'English: Proficient',
  ].join('\n');

  const repairedPdf = buildPdfBuffer(corruptedInput);
  const repairedContent = decodePdf(repairedPdf);
  assert.ok(!/Page\s+1\s+of\s+2/i.test(repairedContent), 'Page labels must be removed before render.');
  assert.ok(!repairedContent.includes('�'), 'Malformed encoding should be removed before render.');

  const pipesInBulletInput = [
    'Jane Doe',
    'Senior Engineer',
    'Professional Summary',
    'Builder of resilient systems.',
    'Core Competencies',
    'API Design',
    'Professional Experience',
    'Senior Engineer | Acme Corp | Remote | 2022 - Present',
    '- Built APIs | React services | AWS',
    '- Led platform migration and reduced downtime.',
    'Education',
    'BSc Computer Science',
    'Tech University',
    '2020',
    'Languages',
    'English: Fluent',
  ].join('\n');

  const pipesInBulletPdf = buildPdfBuffer(pipesInBulletInput);
  const pipesInBulletContent = decodePdf(pipesInBulletPdf);
  assert.ok(
    pipesInBulletContent.includes('(Built APIs | React services | AWS) Tj'),
    'Pipe-delimited bullet content should be preserved as a bullet, not treated as a new role header.',
  );


  const structuredPdf = buildPdfBufferFromStructuredCv({
    fullName: 'Jane Doe',
    professionalTitle: 'Senior Product Manager',
    contact: { location: 'Dubai, UAE', phone: '+971 50 123 4567', email: 'jane@example.com' },
    summary: 'Experienced product manager with 8+ years leading roadmap strategy.',
    skills: ['Product Strategy', 'Stakeholder Management'],
    experience: [
      {
        jobTitle: 'Senior Product Manager',
        company: 'Acme Corp',
        location: 'Dubai, UAE',
        dates: 'Jan 2021 - Present',
        bullets: ['Led discovery and launch of core growth initiatives.'],
      },
    ],
    education: [{ degree: 'MBA, Business Administration', institution: 'State University', date: '2019' }],
    certifications: ['PMP Certification'],
    languages: ['Arabic: Native', 'English: Proficient'],
  });
  const structuredContent = decodePdf(structuredPdf);
  assert.ok(structuredContent.includes('/F2 16 Tf\n(Jane Doe) Tj'), 'Structured path should render the candidate name.');
  assert.ok(structuredContent.includes('(PROFESSIONAL EXPERIENCE) Tj'), 'Structured path should render experience heading.');
  assert.ok(structuredContent.includes('(Led discovery and launch of core growth initiatives.) Tj'), 'Structured bullets should render directly.');

  const parsedWithBlankBulletSpacing = __test.parseExperience([
    'Senior Engineer | Acme Corp | Remote | 2022 - Present',
    '- Built APIs and services',
    '',
    '- Improved uptime to 99.95%',
  ]);
  assert.strictEqual(parsedWithBlankBulletSpacing.length, 1, 'Blank lines between bullets must not split a role.');
  assert.strictEqual(parsedWithBlankBulletSpacing[0].bullets.length, 2, 'Bullets separated by blank lines must remain in the same role.');

  const executiveSummaryCv = [
    'ALI RAZA ZAIDI Learning & Organization Development Leader',
    'Al Khobar, Saudi Arabia Transferable Iqama +966 55 555 5555 | +92 300 0000000 | ali.zaidi@gmail.com',
    '',
    'EXECUTIVE SUMMARY',
    'Learning leader with 15+ years delivering enterprise L&D strategy across GCC.',
    '',
    'SELECTED ACHIEVEMENTS',
    '- Built leadership academy serving 500+ managers.',
    '',
    'PROFESSIONAL EXPERIENCE',
    'Head of Learning | Example Group | Al Khobar | 2021 - Present',
    '- Led enterprise learning roadmap.',
  ].join('\n');

  const executiveStructured = __test.validateAndAutoCorrect(__test.buildStructuredCvObject(executiveSummaryCv));
  assert.strictEqual(executiveStructured.fullName, 'ALI RAZA ZAIDI', 'First line with name and title should split correctly.');
  assert.strictEqual(executiveStructured.professionalTitle, 'Learning & Organization Development Leader', 'Title should be extracted from dense first line.');
  assert.ok(executiveStructured.contact.location.includes('Al Khobar, Saudi Arabia'), 'Location should be parsed from mixed contact line.');
  assert.ok(executiveStructured.contact.phone.includes('+966 55 555 5555'), 'Phone should be parsed from mixed contact line.');
  assert.strictEqual(executiveStructured.contact.email, 'ali.zaidi@gmail.com', 'Email should be parsed from mixed contact line.');
  assert.ok(executiveStructured.professionalSummary.includes('Learning leader'), 'EXECUTIVE SUMMARY must map to professional summary.');
  assert.ok(executiveStructured.professionalExperience.some((role) => role.bullets.some((b) => b.includes('Built leadership academy'))), 'SELECTED ACHIEVEMENTS should flow to experience safely.');

  const malformedHeaderCv = [
    'Ali Raza Zaidi Learning leader with 15+ years driving transformation across businesses. Executive summary and profile details.',
    'PROFESSIONAL EXPERIENCE',
    'Learning Director | Example Co | 2020 - Present',
    '- Delivered strategic initiatives.',
  ].join('\n');
  const malformedStructured = __test.validateAndAutoCorrect(__test.buildStructuredCvObject(malformedHeaderCv));
  assert.ok(!malformedStructured.fullName, 'Summary-like content must never be accepted as fullName.');
  assert.ok(!malformedStructured.professionalTitle || malformedStructured.professionalTitle.length < 80, 'Summary-like content must never render as title.');

  console.log('pdf builder formatting test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
