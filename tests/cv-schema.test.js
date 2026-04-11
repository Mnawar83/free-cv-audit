const assert = require('assert');

async function run() {
  const { normalizeStructuredCv, maybeStructuredCvToTemplateText, tryExtractStructuredCv, structuredCvToTemplateText } = require('../netlify/functions/cv-schema');

  const aiOutput = `Here is your result:
{
  "fullName": "Jane Doe",
  "professionalTitle": "Software Engineer",
  "contact": {
    "location": "Austin, TX",
    "phone": "+1 555-0100",
    "email": "jane@example.com"
  },
  "summary": "Engineer with backend and cloud delivery experience.",
  "skills": ["Node.js", "AWS", "System Design"],
  "experience": [
    {
      "jobTitle": "Software Engineer",
      "company": "Acme",
      "location": "Remote",
      "dates": "2022 - Present",
      "bullets": ["Built APIs", "Reduced latency by 30%"]
    }
  ],
  "education": [
    {
      "degree": "BSc Computer Science",
      "institution": "UT Austin",
      "date": "2021"
    }
  ],
  "certifications": ["AWS Certified Developer"],
  "languages": ["English"]
}`;

  const structured = tryExtractStructuredCv(aiOutput);
  assert.ok(structured, 'Structured CV should be extracted from mixed text + JSON');
  assert.strictEqual(structured.fullName, 'Jane Doe');
  assert.strictEqual(structured.experience.length, 1);

  const templateText = structuredCvToTemplateText(structured);
  assert.ok(templateText.includes('PROFESSIONAL EXPERIENCE'));
  assert.ok(templateText.includes('Software Engineer | Acme | Remote | 2022 - Present'));
  assert.ok(templateText.includes('- Built APIs'));
  assert.ok(templateText.includes('CORE SKILLS\nNode.js, AWS, System Design'));
  assert.ok(!templateText.includes('- Node.js'));

  const fenced = tryExtractStructuredCv(`\`\`\`json\n${aiOutput.slice(aiOutput.indexOf('{'))}\n\`\`\``);
  assert.ok(fenced, 'Structured CV should be extracted from fenced JSON');

  const minimalValid = maybeStructuredCvToTemplateText({
    fullName: 'Test User',
    summary: '',
    experience: [],
    education: [{ degree: 'BSc', institution: 'School', date: '2020' }],
  });
  assert.ok(minimalValid && minimalValid.includes('EDUCATION'), 'Structured template should render for minimally valid CV');

  const placeholderIdentity = normalizeStructuredCv({
    fullName: 'Candidate Name',
    professionalTitle: 'Professional Title',
    summary: 'Valid summary',
    experience: [{ jobTitle: 'Engineer', company: 'Acme', dates: '2022-Present', bullets: ['Did work'] }],
  });
  assert.strictEqual(placeholderIdentity.fullName, '');
  assert.strictEqual(placeholderIdentity.professionalTitle, '');

  console.log('CV schema normalization test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
