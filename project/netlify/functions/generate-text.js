// netlify/functions/generate-text.js
//
// Ця функція приймає дані форми (шаблон + заповнені поля) і звертається
// до Google Gemini API (безкоштовний тариф), щоб написати текст поста за
// правилами з розділу 9 ТЗ. Ключ GEMINI_API_KEY НІКОЛИ не потрапляє в
// браузер — він живе тільки тут, на сервері Netlify (Site settings →
// Environment variables).

const { requireRole } = require('../lib/auth');

const SYSTEM_PROMPT = `Ти — редактор Telegram-каналу Студентського парламенту ІФНТУНГ.
Пишеш українською мовою в такому стилі:

ТОН:
- живий, теплий, дружній;
- студентський, але не занадто розмовний;
- щирий і зрозумілий, без канцеляризмів і надмірного пафосу;
- помірна кількість емодзі (не більше 4-6 на пост);
- без вигаданих фактів.

ФОРМАТ:
- короткі абзаци, між ними порожній рядок;
- важливі думки виділяй **жирним** (Telegram Markdown: **текст**);
- атмосферні або емоційні фрази можна робити *курсивом* (*текст*);
- посилання вбудовуй у текст як [текст](url);
- текст не повинен бути надто довгим (орієнтовно 400-800 символів без урахування підпису).

КРИТИЧНО ВАЖЛИВО — ФАКТИ:
- Використовуй ЛИШЕ факти, які прямо передані в полях нижче. Нічого не вигадуй:
  не додумуй дати, суми, кількість учасників, переможців, партнерів, цитати.
- Якщо для якісного поста бракує важливих даних (наприклад, немає посилання
  на реєстрацію, часу події чи суми збору) — не вигадуй заміну, а додай
  ці пункти в масив "clarifications".
- Для звітних постів (звіт з заходу/турніру/поїздки) не вигадуй переможців,
  партнерів чи результати, якщо їх не було в полях.
- Для святкових постів можна використати загальновідомий сенс свята, але без
  сумнівних або невигаданих історичних деталей.

Відповідай СТРОГО у форматі JSON без жодного тексту навколо, без markdown-огорожі:
{"text": "готовий текст поста тут (без стандартного підпису в кінці)", "clarifications": ["список уточнень, якщо чогось бракує, або порожній масив"]}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Генерація тексту витрачає квоту Gemini-ключа, тож доступна лише тим,
  // хто реально створює пости (viewer — лише перегляд і копіювання).
  const guard = await requireRole(event, ['owner', 'admin', 'editor']);
  if (!guard.ok) {
    return { statusCode: guard.statusCode, body: JSON.stringify({ error: guard.error }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Некоректний JSON у запиті' }) };
  }

  const { templateName, templateDescription, fields } = body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY не налаштовано в Netlify (Site settings → Environment variables).' })
    };
  }

  const fieldsList = Object.entries(fields || {})
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(жодне поле не заповнене)';

  const userPrompt = `Тип шаблону: ${templateName}
Опис шаблону: ${templateDescription || ''}

Заповнені поля форми:
${fieldsList}

Напиши пост за цими даними і поверни лише JSON у вказаному форматі.`;

  if (typeof fetch === 'undefined') {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'У цьому Node-рантаймі немає вбудованого fetch. Потрібен Node 18+ (додай NODE_VERSION у netlify.toml).' })
    };
  }

  try {
    const model = 'gemini-3.5-flash-lite';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 2048,
            responseSchema: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
                clarifications: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                }
              },
              required: ['text', 'clarifications']
            },
            // Gemini 3 uses thinkingLevel. The old thinkingBudget setting caused
            // a 400 response for this model and silently triggered the fallback.
            thinkingConfig: { thinkingLevel: 'low' }
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', JSON.stringify(data));
      return { statusCode: response.status, body: JSON.stringify({ error: data }) };
    }

    const candidate = data.candidates?.[0];
    const raw = (candidate?.content?.parts || []).map((p) => p.text || '').join('\n');
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      if (candidate?.finishReason === 'MAX_TOKENS' || !clean) {
        return {
          statusCode: 502,
          body: JSON.stringify({ error: 'Модель не встигла дописати текст (обрізалась відповідь). Спробуйте ще раз — зазвичай з другого разу спрацьовує.' })
        };
      }
      // Якщо модель не повернула чистий JSON — віддаємо сирий текст,
      // щоб інтерфейс все одно показав хоч щось, а не впав з помилкою.
      parsed = { text: raw, clarifications: [] };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    console.error('Function crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Не вдалося згенерувати текст. Спробуйте ще раз трохи пізніше.' }) };
  }
};
