// netlify/lib/auth.js
//
// Спільні функції авторизації: хешування паролів, підпис/перевірка
// сесійних токенів (кука), парсинг кук, перевірка ролі.
//
// Без зовнішніх залежностей — тільки вбудований Node.js `crypto`
// (scrypt для паролів, HMAC-SHA256 для підпису сесії).

const crypto = require('crypto');
const { openStore } = require('./store');

const SESSION_COOKIE = 'sp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 днів

// ---------- Паролі ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- Сесія (підписана кука, без БД сесій) ----------

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET не налаштовано в Netlify (Site settings → Environment variables).');
  }
  return secret;
}

function signSession(payload) {
  const secret = getSecret();
  const body = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  try {
    const secret = getSecret();
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getSessionFromEvent(event) {
  const header = event.headers && (event.headers.cookie || event.headers.Cookie);
  const cookies = parseCookies(header);
  return verifySession(cookies[SESSION_COOKIE]);
}

async function getCurrentUser(session) {
  if (!session || !session.id) return null;

  if (session.id === 'owner') {
    const email = process.env.OWNER_EMAIL;
    const name = process.env.OWNER_NAME || 'Власник';
    return email ? { id: 'owner', name, email, role: 'owner', status: 'active' } : null;
  }

  const usersStore = openStore('users');
  const user = await usersStore.get(session.id, { type: 'json' }).catch(() => null);
  if (!user || user.status !== 'active') return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

async function getSessionUserFromEvent(event) {
  return getCurrentUser(getSessionFromEvent(event));
}

// NETLIFY_DEV=true виставляє сам Netlify CLI під час `netlify dev`.
// Локально сайт зазвичай віддається по http://localhost — і кука з
// прапорцем Secure у такому разі браузером просто ігнорується.
function sessionCookieHeader(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secureFlag = process.env.NETLIFY_DEV ? '' : ' Secure;';
  return `${SESSION_COOKIE}=${token}; HttpOnly;${secureFlag} SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearCookieHeader() {
  const secureFlag = process.env.NETLIFY_DEV ? '' : ' Secure;';
  return `${SESSION_COOKIE}=; HttpOnly;${secureFlag} SameSite=Lax; Path=/; Max-Age=0`;
}

// ---------- Ролі ----------
// owner  — повний доступ, єдиний;
// admin  — створення/редагування постів + керування календарем;
// editor — створення і редагування постів;
// viewer — лише перегляд і копіювання.

async function requireRole(event, allowedRoles) {
  const user = await getSessionUserFromEvent(event);
  if (!user) {
    return { ok: false, statusCode: 401, error: 'Потрібна авторизація' };
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return { ok: false, statusCode: 403, error: 'Недостатньо прав для цієї дії' };
  }
  return { ok: true, session: user };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  parseCookies,
  getSessionFromEvent,
  getSessionUserFromEvent,
  sessionCookieHeader,
  clearCookieHeader,
  requireRole,
};
