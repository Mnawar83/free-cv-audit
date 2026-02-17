const dns = require('dns').promises;
const net = require('net');
const { COVER_LETTER_MAX_EXTRACTED_TEXT } = require('./cover-letter-constants');

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_URL_LENGTH = 2048;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:127.') ||
    normalized === '::'
  );
}

async function assertSafeJobUrl(jobLink) {
  if (!jobLink || typeof jobLink !== 'string') {
    throw new Error('jobLink is required.');
  }
  if (jobLink.length > MAX_URL_LENGTH) {
    throw new Error('jobLink is too long.');
  }

  const parsed = new URL(jobLink);
  const protocol = (parsed.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed.');
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed.');
  }

  const records = await dns.lookup(hostname, { all: true });
  if (!records?.length) {
    throw new Error('Unable to resolve job link host.');
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error('Private network URLs are not allowed.');
    }
  }

  return parsed.toString();
}

async function fetchJobPageWithPuppeteer(jobLink) {
  let browser;
  try {
    const safeUrl = await assertSafeJobUrl(jobLink);
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(safeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT_MS,
    });

    const text = await page.evaluate(() => (document.body?.innerText || '').trim());
    const cappedText = text.slice(0, COVER_LETTER_MAX_EXTRACTED_TEXT);

    return {
      text: cappedText,
      length: cappedText.length,
    };
  } catch (error) {
    return {
      text: '',
      length: 0,
      error: error.message || 'Unable to fetch job page.',
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  fetchJobPageWithPuppeteer,
};
