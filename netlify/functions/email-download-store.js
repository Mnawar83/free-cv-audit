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
    try {
      await blobStore.setJSON(token, snapshot);
      return;
    } catch (error) {
      console.warn('Blob snapshot write failed; falling back to run-store.', error?.message || error);
    }
  }
  await upsertEmailDownload(token, snapshot);
}

async function getEmailDownloadSnapshot(event, token) {
  const blobStore = getBlobStore(event);
  if (blobStore) {
    try {
      const data = await blobStore.get(token, { type: 'json' });
      if (data) return data;
    } catch (error) {
      console.warn('Blob snapshot read failed; falling back to run-store.', error?.message || error);
    }
  }
  return getEmailDownload(token);
}

module.exports = { getEmailDownloadSnapshot, saveEmailDownloadSnapshot };
