// netlify/functions/generate-text.js
//
// Ця функція приймає дані форми (шаблон + заповнені поля) і звертається
// до Claude API, щоб написати текст поста за правилами з розділу 9 ТЗ.
// Ключ ANTHROPIC_API_KEY НІКОЛИ не потрапляє в браузер — він живе тільки
// тут, на сервері Netlify (задається в Site settings → Environment variables).

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

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Некоректний JSON у запиті' }) };
  }

  const { templateName, templateDescription, fields } = body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY не налаштовано в Netlify (Site settings → Environment variables).' })
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

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data }) };
    }

    const raw = (data.content || []).map((b) => b.text || '').join('\n');
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
