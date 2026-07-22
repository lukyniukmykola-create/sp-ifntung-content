// netlify/functions/events.js
//
// CRUD для подій календаря. Так само через Netlify Blobs.
//
// GET    /.netlify/functions/events          -> список усіх подій
// POST   /.netlify/functions/events          -> створити або оновити подію (body.id є/нема)
// DELETE /.netlify/functions/events?id=...   -> видалити подію

const { openStore } = require('../lib/store');
const { requireRole } = require('../lib/auth');

const CORS_HEADERS = { 'Content-Type': 'application/json' };

// GET доступний будь-якому автентифікованому користувачу.
// POST/DELETE (керування календарем) — лише власнику й адміну.
const WRITE_ROLES = ['owner', 'admin'];

exports.handler = async (event) => {
  const readGuard = requireRole(event, null);
  if (!readGuard.ok) {
    return { statusCode: readGuard.statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: readGuard.error }) };
  }

  if (event.httpMethod !== 'GET') {
    const writeGuard = requireRole(event, WRITE_ROLES);
    if (!writeGuard.ok) {
      return { statusCode: writeGuard.statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: writeGuard.error }) };
    }
  }

  const store = openStore('events');

  try {
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();
      const items = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null))
      );
      const events = items.filter(Boolean).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(events) };
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();
      const id = data.id || `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const evt = { ...data, id, updatedAt: now, createdAt: data.createdAt || now };
      await store.setJSON(id, evt);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(evt) };
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
    console.error('events function error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
