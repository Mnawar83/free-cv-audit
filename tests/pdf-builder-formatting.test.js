const assert = require('assert');
const { buildPdfBuffer, __test } = require('../netlify/functions/pdf-builder');

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

  const parsedWithBlankBulletSpacing = __test.parseExperience([
    'Senior Engineer | Acme Corp | Remote | 2022 - Present',
    '- Built APIs and services',
    '',
    '- Improved uptime to 99.95%',
  ]);
  assert.strictEqual(parsedWithBlankBulletSpacing.length, 1, 'Blank lines between bullets must not split a role.');
  assert.strictEqual(parsedWithBlankBulletSpacing[0].bullets.length, 2, 'Bullets separated by blank lines must remain in the same role.');

  console.log('pdf builder formatting test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
