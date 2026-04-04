const { getEmailDownload, upsertEmailDownload } = require('./run-store');

const EMAIL_DOWNLOAD_STORE_NAME = 'cv-email-downloads';

function getBlobStore(event) {
  try {
    // Lazy-load so local test environments without node_modules still work.
    const { connectLambda, getStore } = require('@netlify/blobs');
    connectLambda(event);
    return getStore(EMAIL_DOWNLOAD_STORE_NAME);
  } catch (error) {
    return null;
  }
}

async function saveEmailDownloadSnapshot(event, token, snapshot) {
  const blobStore = getBlobStore(event);
  if (blobStore) {
    await blobStore.setJSON(token, snapshot);
    return;
  }
  await upsertEmailDownload(token, snapshot);
}

async function getEmailDownloadSnapshot(event, token) {
  const blobStore = getBlobStore(event);
  if (blobStore) {
    const data = await blobStore.get(token, { type: 'json' });
    if (data) return data;
  }
  return getEmailDownload(token);
}

module.exports = { getEmailDownloadSnapshot, saveEmailDownloadSnapshot };
