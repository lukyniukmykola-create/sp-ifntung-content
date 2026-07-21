// netlify/functions/users.js
//
// Керування людьми й ролями. Доступно лише власнику (role: 'owner') —
// відповідно до розділу 9 ТЗ: "Має бути один власник. Власник може:
// додавати людей; забирати доступ; давати ролі; бачити список користувачів".
//
// GET    /.netlify/functions/users          -> список користувачів (без паролів)
// POST   /.netlify/functions/users          -> додати людину АБО оновити роль/пароль/статус (якщо є body.id)
// DELETE /.netlify/functions/users?id=...   -> забрати доступ
//
// MVP-спрощення: без надсилання email-запрошень. Власник задає тимчасовий
// пароль вручну і повідомляє людині особисто/у Telegram. Само-зміна пароля
// поки не реалізована — це можна додати окремим кроком пізніше.

const { openStore } = require('../lib/store');
const { requireRole, hashPassword } = require('../lib/auth');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer'];

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

exports.handler = async (event) => {
  const guard = requireRole(event, ['owner']);
  if (!guard.ok) {
    return { statusCode: guard.statusCode, headers: JSON_HEADERS, body: JSON.stringify({ error: guard.error }) };
  }

  const usersStore = openStore('users');

  try {
    if (event.httpMethod === 'GET') {
      const { blobs } = await usersStore.list();
      const items = await Promise.all(blobs.map((b) => usersStore.get(b.key, { type: 'json' }).catch(() => null)));
      const users = items
        .filter(Boolean)
        .map(publicUser)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(users) };
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      if (data.role && !ASSIGNABLE_ROLES.includes(data.role)) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: `Роль має бути однією з: ${ASSIGNABLE_ROLES.join(', ')}` }),
        };
      }

      // Оновлення наявного користувача
      if (data.id) {
        const existing = await usersStore.get(data.id, { type: 'json' }).catch(() => null);
        if (!existing) {
          return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Користувача не знайдено' }) };
        }
        const updated = {
          ...existing,
          name: data.name ?? existing.name,
          role: data.role ?? existing.role,
          status: data.status ?? existing.status,
          passwordHash: data.password ? hashPassword(data.password) : existing.passwordHash,
          updatedAt: now,
        };
        await usersStore.setJSON(data.id, updated);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(publicUser(updated)) };
      }

      // Створення нового користувача
      if (!data.email || !data.password || !data.name) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Вкажіть ім'я, email і тимчасовий пароль" }),
        };
      }

      const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const user = {
        id,
        name: data.name,
        email: data.email,
        role: data.role || 'viewer',
        status: 'active',
        passwordHash: hashPassword(data.password),
        createdAt: now,
        updatedAt: now,
      };
      await usersStore.setJSON(id, user);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(publicUser(user)) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Не вказано id' }) };
      }
      if (id === guard.session.id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Не можна видалити самого себе' }) };
      }
      await usersStore.delete(id);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('users function error:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
