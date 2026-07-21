// netlify/functions/drafts.js
//
// CRUD для чернеток. Дані живуть у Netlify Blobs (вбудоване сховище Netlify,
// не потребує окремого акаунта чи налаштувань — працює одразу після деплою).
//
// GET    /.netlify/functions/drafts          -> список усіх чернеток
// POST   /.netlify/functions/drafts          -> створити або оновити чернетку (body.id є/нема)
// DELETE /.netlify/functions/drafts?id=...   -> видалити чернетку

const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  const store = getStore({
  name: 'drafts',
  siteID: process.env.BLOBS_SITE_ID,
  token: process.env.BLOBS_TOKEN,
});

  try {
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();
      const items = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null))
      );
      const drafts = items.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(drafts) };
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();
      const id = data.id || `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const draft = { ...data, id, updatedAt: now, createdAt: data.createdAt || now };
      await store.setJSON(id, draft);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(draft) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Не вказано id' }) };
      }
      await store.delete(id);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('drafts function error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
