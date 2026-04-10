const assert = require('assert');
const { buildPdfBuffer, __test } = require('../netlify/functions/pdf-builder');

const {
  buildStructuredCvObject,
  validateAndAutoCorrect,
  buildRenderBlocks,
  validateRenderBlocks,
  containsForbiddenPhrase,
  FORBIDDEN_PHRASES,
  parseExperience,
} = __test;

function decodePdf(buffer) {
  return buffer.toString('latin1');
}

// --- Short CV (minimal data) ---
const SHORT_CV = [
  'Alice Johnson',
  'Software Developer',
  'alice@example.com',
  '',
  'Professional Summary',
  'Skilled developer with 3 years of experience in web applications.',
  '',
  'Professional Experience',
  'Developer | TechCo | London | 2021 - Present',
  '- Built REST APIs using Node.js',
  '- Maintained CI/CD pipelines',
  '',
  'Education',
  'BSc Computer Science',
  'University of London',
  '2020',
].join('\n');

// --- Medium CV (typical) ---
const MEDIUM_CV = [
  'James Carter',
  'Senior Product Manager',
  'Dubai, UAE | +971 55 987 6543 | james.carter@email.com',
  '',
  'Professional Summary',
  'Strategic product manager with 10+ years driving roadmap execution, stakeholder alignment, and go-to-market strategy across fintech and SaaS platforms.',
  '',
  'Core Competencies',
  'Product Strategy | Roadmap Planning | Stakeholder Management | Agile Delivery | Data Analytics',
  '',
  'Professional Experience',
  'Senior Product Manager | Fintech Corp | Dubai | Jan 2021 - Present',
  '- Led cross-functional team of 12 to launch new payments platform.',
  '- Increased user retention by 25% through data-driven feature prioritization.',
  '- Managed quarterly OKRs and product review cadence.',
  '',
  'Product Manager | SaaS Inc | London | Mar 2017 - Dec 2020',
  '- Defined and delivered roadmap for enterprise analytics dashboard.',
  '- Collaborated with engineering and design teams across 3 time zones.',
  '- Reduced churn by 15% through proactive customer feedback loops.',
  '',
  'Education',
  'MBA, Business Administration',
  'London Business School',
  '2016',
  '',
  'BSc Economics',
  'University of Manchester',
  '2012',
  '',
  'Technical Skills',
  'SQL | Jira | Mixpanel | Tableau | Figma',
  '',
  'Certifications',
  'Certified Scrum Product Owner (CSPO)',
  'Google Analytics Certification',
  '',
  'Languages',
  'English: Native',
  'Arabic: Conversational',
].join('\n');

// --- Long CV (extensive experience) ---
const LONG_CV = [
  'Sarah Williams',
  'Chief Technology Officer',
  'New York, USA | +1 212 555 0199 | sarah.williams@email.com',
  '',
  'Professional Summary',
  'Visionary technology leader with 18+ years of experience scaling engineering organizations, driving digital transformation, and delivering enterprise platforms. Proven track record of building high-performing teams and aligning technology strategy with business objectives.',
  '',
  'Core Competencies',
  'Engineering Leadership | Cloud Architecture | Digital Transformation | Team Building | Strategic Planning | Vendor Management | Security Governance',
  '',
  'Professional Experience',
  'Chief Technology Officer | GlobalTech Inc | New York | Jan 2020 - Present',
  '- Lead engineering organization of 150+ across 4 global offices.',
  '- Architected migration to microservices reducing deployment time by 70%.',
  '- Established security-first development practices achieving SOC 2 compliance.',
  '- Drove annual technology budget of $45M with 15% cost optimization.',
  '',
  'VP of Engineering | DataStream Corp | San Francisco | Jun 2016 - Dec 2019',
  '- Scaled engineering team from 20 to 85 engineers across 3 product lines.',
  '- Led platform re-architecture handling 10x traffic growth.',
  '- Implemented engineering excellence program reducing production incidents by 60%.',
  '- Partnered with product leadership to define 3-year technology roadmap.',
  '',
  'Senior Engineering Manager | CloudFirst Ltd | Boston | Mar 2012 - May 2016',
  '- Managed 4 engineering squads delivering cloud infrastructure products.',
  '- Drove adoption of containerization and CI/CD pipelines.',
  '- Mentored 12 engineers with 3 promoted to senior roles.',
  '',
  'Software Engineer | StartupXYZ | Austin | Jan 2008 - Feb 2012',
  '- Built real-time data processing pipeline handling 1M events per second.',
  '- Designed and implemented RESTful API consumed by 50+ enterprise clients.',
  '- Contributed to open-source monitoring tools adopted by 500+ companies.',
  '',
  'Education',
  'MS Computer Science',
  'MIT',
  '2007',
  '',
  'BS Computer Science',
  'University of Texas at Austin',
  '2005',
  '',
  'Technical Skills',
  'AWS | GCP | Kubernetes | Docker | Terraform | Python | Go | Java | PostgreSQL | Redis | Kafka',
  '',
  'Certifications',
  'AWS Solutions Architect Professional',
  'Google Cloud Professional Cloud Architect',
  'Certified Kubernetes Administrator',
  '',
  'Languages',
  'English: Native',
  'Spanish: Intermediate',
  'Mandarin: Basic',
].join('\n');

async function run() {
  // ===== Test 1: Short CV renders without placeholders =====
  const shortPdf = buildPdfBuffer(SHORT_CV);
  const shortContent = decodePdf(shortPdf);
  assert.ok(shortPdf.length > 500, 'Short CV should generate valid PDF.');
  assert.ok(shortContent.includes('(Alice Johnson) Tj'), 'Short CV should contain candidate name.');
  assert.ok(!shortContent.includes('Candidate Name'), 'Short CV must not contain placeholder name.');
  assert.ok(!shortContent.includes('Professional Title'), 'Short CV must not contain placeholder title.');
  assert.ok(!shortContent.includes('Recent Professional Experience'), 'Short CV must not contain placeholder experience.');
  console.log('  PASS: Short CV renders without placeholders');

  // ===== Test 2: Medium CV renders all sections =====
  const mediumPdf = buildPdfBuffer(MEDIUM_CV);
  const mediumContent = decodePdf(mediumPdf);
  assert.ok(mediumContent.includes('(James Carter) Tj'), 'Medium CV should contain candidate name.');
  assert.ok(mediumContent.includes('PROFESSIONAL SUMMARY'), 'Medium CV should have summary heading.');
  assert.ok(mediumContent.includes('CORE COMPETENCIES'), 'Medium CV should have competencies heading.');
  assert.ok(mediumContent.includes('PROFESSIONAL EXPERIENCE'), 'Medium CV should have experience heading.');
  assert.ok(mediumContent.includes('EDUCATION'), 'Medium CV should have education heading.');
  assert.ok(mediumContent.includes('LANGUAGES'), 'Medium CV should have languages heading.');
  assert.ok(mediumContent.includes('Fintech Corp'), 'Medium CV should contain first company.');
  assert.ok(mediumContent.includes('SaaS Inc'), 'Medium CV should contain second company.');
  console.log('  PASS: Medium CV renders all sections');

  // ===== Test 3: Long CV renders multiple experience entries as separate blocks =====
  const longPdf = buildPdfBuffer(LONG_CV);
  const longContent = decodePdf(longPdf);
  assert.ok(longContent.includes('(Sarah Williams) Tj'), 'Long CV should contain candidate name.');
  assert.ok(longContent.includes('GlobalTech Inc'), 'Long CV should contain first company.');
  assert.ok(longContent.includes('DataStream Corp'), 'Long CV should contain second company.');
  assert.ok(longContent.includes('CloudFirst Ltd'), 'Long CV should contain third company.');
  assert.ok(longContent.includes('StartupXYZ'), 'Long CV should contain fourth company.');
  console.log('  PASS: Long CV renders all experience entries');

  // ===== Test 4: No forbidden phrases in any output =====
  for (const [label, cv] of [['short', SHORT_CV], ['medium', MEDIUM_CV], ['long', LONG_CV]]) {
    const content = decodePdf(buildPdfBuffer(cv));
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(
        !content.toLowerCase().includes(phrase),
        `${label} CV must not contain forbidden phrase: "${phrase}"`,
      );
    }
  }
  console.log('  PASS: No forbidden phrases in any output');

  // ===== Test 5: Name formatting is correct =====
  const mediumBlocks = buildRenderBlocks(validateAndAutoCorrect(buildStructuredCvObject(MEDIUM_CV)));
  const nameBlock = mediumBlocks.find((b) => b.type === 'line' && b.font === 'F2' && b.align === 'center');
  assert.ok(nameBlock, 'Name block should exist.');
  assert.strictEqual(nameBlock.size, 16, 'Name should be 16pt (body 10pt + 6pt larger).');
  assert.strictEqual(nameBlock.font, 'F2', 'Name should be bold.');
  assert.strictEqual(nameBlock.text, 'James Carter', 'Name text should be correct.');
  console.log('  PASS: Name formatting is correct');

  // ===== Test 6: Headings are bold and consistent =====
  const headingBlocks = mediumBlocks.filter((b) => b.type === 'heading');
  headingBlocks.forEach((h) => {
    assert.strictEqual(h.font, 'F2', `Heading "${h.text}" should be bold.`);
    assert.strictEqual(h.size, 11, `Heading "${h.text}" should be 11pt.`);
  });
  console.log('  PASS: All headings are bold and consistent');

  // ===== Test 7: Experience bullets are individual, not paragraph blocks =====
  const bulletBlocks = mediumBlocks.filter((b) => b.type === 'bullet');
  assert.ok(bulletBlocks.length >= 6, 'Medium CV should have at least 6 bullet points.');
  bulletBlocks.forEach((b) => {
    assert.ok(b.text.length > 5, `Bullet should have meaningful content: "${b.text}".`);
    assert.ok(!b.text.includes('\n'), 'Bullets should not contain newlines.');
  });
  console.log('  PASS: Experience bullets are individual');

  // ===== Test 8: No duplicate headings =====
  const headingTexts = headingBlocks.map((h) => h.text);
  const uniqueHeadings = new Set(headingTexts);
  assert.strictEqual(headingTexts.length, uniqueHeadings.size, 'No duplicate section headings.');
  console.log('  PASS: No duplicate headings');

  // ===== Test 9: Contact line renders correctly =====
  const contactBlock = mediumBlocks.find((b) => b.type === 'line' && b.align === 'center' && b.text.includes('@'));
  assert.ok(contactBlock, 'Contact line should exist.');
  assert.ok(contactBlock.text.includes('james.carter@email.com'), 'Contact line should include email.');
  console.log('  PASS: Contact line renders correctly');

  // ===== Test 10: Missing sections are omitted, not filled with placeholders =====
  const minimalCv = [
    'Test Person',
    'test@example.com',
    '',
    'Professional Summary',
    'Experienced professional in software development.',
    '',
    'Professional Experience',
    'Developer | SomeCo | Remote | 2023 - Present',
    '- Built features and fixed bugs',
  ].join('\n');
  const minimalPdf = buildPdfBuffer(minimalCv);
  const minimalContent = decodePdf(minimalPdf);
  assert.ok(minimalContent.includes('(Test Person) Tj'), 'Minimal CV should render name.');
  assert.ok(!minimalContent.includes('LANGUAGES'), 'Minimal CV should not have languages heading when no language data.');
  assert.ok(!minimalContent.includes('EDUCATION'), 'Minimal CV should not have education heading when no education data.');
  assert.ok(!minimalContent.includes('Process Improvement'), 'Minimal CV should not contain fallback competencies.');
  console.log('  PASS: Missing sections are omitted cleanly');

  // ===== Test 11: containsForbiddenPhrase works correctly =====
  assert.ok(containsForbiddenPhrase('Candidate Name'), 'Should detect "Candidate Name".');
  assert.ok(containsForbiddenPhrase('Professional Title'), 'Should detect "Professional Title".');
  assert.ok(containsForbiddenPhrase('Recent Professional Experience'), 'Should detect "Recent Professional Experience".');
  assert.ok(!containsForbiddenPhrase('Senior Software Engineer'), 'Should not flag legitimate titles.');
  assert.ok(!containsForbiddenPhrase('Led team of 5 engineers'), 'Should not flag legitimate bullets.');
  console.log('  PASS: Forbidden phrase detection works');

  // ===== Test 12: Flexible experience header parsing (2-part pipe format) =====
  const twoPartExperience = parseExperience([
    'Developer | SomeCo',
    '- Built APIs',
    '- Fixed bugs',
  ]);
  assert.strictEqual(twoPartExperience.length, 1, 'Should parse 2-part pipe header.');
  assert.strictEqual(twoPartExperience[0].jobTitle, 'Developer', 'Job title should be first part.');
  assert.strictEqual(twoPartExperience[0].company, 'SomeCo', 'Company should be second part.');
  assert.strictEqual(twoPartExperience[0].bullets.length, 2, 'Should have 2 bullets.');
  console.log('  PASS: Flexible experience header parsing');

  // ===== Test 13: Three-part pipe format =====
  const threePartExperience = parseExperience([
    'Manager | BigCorp | 2020 - 2023',
    '- Managed team of 10',
  ]);
  assert.strictEqual(threePartExperience.length, 1, 'Should parse 3-part pipe header.');
  assert.strictEqual(threePartExperience[0].jobTitle, 'Manager', 'Job title should be first part.');
  assert.strictEqual(threePartExperience[0].company, 'BigCorp', 'Company should be second part.');
  assert.strictEqual(threePartExperience[0].dateRange, '2020 - 2023', 'Date range should be third part.');
  console.log('  PASS: Three-part experience header parsing');

  // ===== Test 14: Word spacing is preserved (no corruption from normalizeLine) =====
  const spacingCv = [
    'A B Test Name',
    'I am a professional',
    '',
    'Professional Summary',
    'I am an experienced professional. A key strength is attention to detail.',
    '',
    'Professional Experience',
    'Lead Engineer | A B Corp | NY | 2020 - 2023',
    '- I built a system from scratch',
    '- Managed a team of 5 in a fast-paced environment',
  ].join('\n');
  const spacingPdf = buildPdfBuffer(spacingCv);
  const spacingContent = decodePdf(spacingPdf);
  assert.ok(spacingContent.includes('A B Test Name'), 'Single-letter words in name should be preserved.');
  assert.ok(spacingContent.includes('I am an experienced'), 'Single-letter words in summary should be preserved.');
  assert.ok(spacingContent.includes('I built a system'), 'Single-letter words in bullets should be preserved.');
  console.log('  PASS: Word spacing is preserved correctly');

  // ===== Test 15: validateRenderBlocks rejects forbidden phrases =====
  const blocksWithPlaceholder = [
    { type: 'line', text: 'Test Person', font: 'F2', size: 16, align: 'center' },
    { type: 'heading', text: 'PROFESSIONAL EXPERIENCE', font: 'F2', size: 11 },
    { type: 'line', text: 'Recent Professional Experience', font: 'F2', size: 10.5 },
    { type: 'bullet', text: 'Delivered responsibilities aligned with role requirements and quality standards.', font: 'F1', size: 10 },
  ];
  assert.throws(
    () => validateRenderBlocks(blocksWithPlaceholder),
    /placeholder text detected/,
    'Should reject blocks containing forbidden placeholder phrases.',
  );
  console.log('  PASS: validateRenderBlocks rejects forbidden phrases');

  // ===== Test 16: No extra/fallback pages in output =====
  for (const [label, cv] of [['short', SHORT_CV], ['medium', MEDIUM_CV], ['long', LONG_CV]]) {
    const content = decodePdf(buildPdfBuffer(cv));
    const pageCount = (content.match(/\/Type \/Page\b/g) || []).length;
    if (label === 'short') {
      assert.ok(pageCount <= 2, `Short CV should be 1-2 pages, got ${pageCount}.`);
    }
    assert.ok(pageCount <= 3, `${label} CV should not have excessive pages (got ${pageCount}).`);
  }
  console.log('  PASS: No extra/fallback pages');

  // ===== Test 17: PDF is deterministic (same input produces same output) =====
  const pdf1 = buildPdfBuffer(MEDIUM_CV);
  const pdf2 = buildPdfBuffer(MEDIUM_CV);
  assert.ok(pdf1.equals(pdf2), 'Same input should produce identical PDF output.');
  console.log('  PASS: PDF output is deterministic');

  console.log('\nAll CV pipeline validation tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
