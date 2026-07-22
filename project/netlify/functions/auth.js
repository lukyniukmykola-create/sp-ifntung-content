// netlify/functions/auth.js
//
// Логін / логаут / перевірка поточної сесії.
//
// GET  /.netlify/functions/auth
//   -> 200 { id, name, email, role }  якщо кука сесії валідна
//   -> 401 { error }                  якщо сесії нема / протухла
//
// POST /.netlify/functions/auth
//   body { action: 'login', email, password }
//     -> звіряє з OWNER_EMAIL/OWNER_PASSWORD (владелец) АБО з users-store
//     -> ставить підписану HttpOnly-куку і повертає { id, name, email, role }
//   body { action: 'logout' }
//     -> чистить куку

const { openStore } = require('../lib/store');
const {
  verifyPassword,
  signSession,
  getSessionUserFromEvent,
  sessionCookieHeader,
  clearCookieHeader,
} = require('../lib/auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function findUserByEmail(email) {
  const store = openStore('users');
  const { blobs } = await store.list();
  const items = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null))
  );
  const norm = String(email).trim().toLowerCase();
  return items.find((u) => u && String(u.email).trim().toLowerCase() === norm) || null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const user = await getSessionUserFromEvent(event);
      if (!user) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Немає сесії' }) };
      }
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(user),
      };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      if (body.action === 'logout') {
        return {
          statusCode: 200,
          headers: { ...JSON_HEADERS, 'Set-Cookie': clearCookieHeader() },
          body: JSON.stringify({ ok: true }),
        };
      }

      if (body.action === 'login') {
        const email = String(body.email || '').trim();
        const password = String(body.password || '');

        if (!email || !password) {
          return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "Вкажіть email і пароль" }) };
        }

        const ownerEmail = process.env.OWNER_EMAIL;
        const ownerPassword = process.env.OWNER_PASSWORD;
        if (!ownerEmail || !ownerPassword) {
          return {
            statusCode: 500,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: 'OWNER_EMAIL / OWNER_PASSWORD не налаштовано в Netlify (Site settings → Environment variables).' }),
          };
        }

        let user = null;

        // Власник — окремий випадок, credentials беруться напряму з env,
        // а не з users-store (щоб завжди був хоча б один робочий вхід).
        if (email.toLowerCase() === ownerEmail.trim().toLowerCase() && password === ownerPassword) {
          user = { id: 'owner', name: process.env.OWNER_NAME || 'Власник', email: ownerEmail, role: 'owner' };
        } else {
          const stored = await findUserByEmail(email);
          if (stored && stored.status === 'active' && verifyPassword(password, stored.passwordHash)) {
            user = { id: stored.id, name: stored.name, email: stored.email, role: stored.role };
          }
        }

        if (!user) {
          return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Невірний email або пароль' }) };
        }

        const token = signSession({ id: user.id });
        return {
          statusCode: 200,
          headers: { ...JSON_HEADERS, 'Set-Cookie': sessionCookieHeader(token) },
          body: JSON.stringify(user),
        };
      }

      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Невідома дія' }) };
    }

    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('auth function error:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
