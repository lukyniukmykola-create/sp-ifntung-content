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

const DEFAULT_EVENTS_MARKER = '__calendar_defaults_2026';
const DEFAULT_EVENTS_2026 = [
  ['2026-01-01', 'Новий рік'],
  ['2026-01-22', 'День Соборності України'],
  ['2026-02-20', 'День Героїв Небесної Сотні'],
  ['2026-03-08', 'Міжнародний жіночий день'],
  ['2026-04-12', 'Великдень'],
  ['2026-05-10', 'День матері'],
  ['2026-05-21', 'День вишиванки'],
  ['2026-05-23', 'День Героїв'],
  ['2026-06-28', 'День Конституції України'],
  ['2026-07-15', 'День Української Державності'],
  ['2026-08-24', 'День Незалежності України'],
  ['2026-10-01', 'День захисників і захисниць України'],
  ['2026-11-17', 'Міжнародний день студентів'],
  ['2026-11-21', 'День Гідності та Свободи'],
  ['2026-11-28', 'День памʼяті жертв Голодоморів'],
  ['2026-12-25', 'Різдво Христове'],
].map(([date, title]) => ({
  id: `system-${date}`,
  date,
  title,
  type: 'Свято',
  category: 'Важлива дата',
  isSystem: true,
}));

async function ensureDefaultEvents(store) {
  const marker = await store.get(DEFAULT_EVENTS_MARKER, { type: 'json' }).catch(() => null);
  if (marker) return;

  const now = new Date().toISOString();
  await Promise.all(DEFAULT_EVENTS_2026.map((event) => store.setJSON(event.id, {
    ...event,
    createdAt: now,
    updatedAt: now,
  })));
  await store.setJSON(DEFAULT_EVENTS_MARKER, { seededAt: now });
}

// GET доступний будь-якому автентифікованому користувачу.
// POST/DELETE (керування календарем) — лише власнику й адміну.
const WRITE_ROLES = ['owner', 'admin'];

exports.handler = async (event) => {
  const readGuard = await requireRole(event, null);
  if (!readGuard.ok) {
    return { statusCode: readGuard.statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: readGuard.error }) };
  }

  if (event.httpMethod !== 'GET') {
    const writeGuard = await requireRole(event, WRITE_ROLES);
    if (!writeGuard.ok) {
      return { statusCode: writeGuard.statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: writeGuard.error }) };
    }
  }

  const store = openStore('events');

  try {
    if (event.httpMethod === 'GET') {
      await ensureDefaultEvents(store);
      const { blobs } = await store.list();
      const items = await Promise.all(
        blobs
          .filter((b) => b.key !== DEFAULT_EVENTS_MARKER)
          .map((b) => store.get(b.key, { type: 'json' }).catch(() => null))
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
