// netlify/functions/generate-image.js
//
// Генерація фонового зображення для превʼю поста через Pollinations.
// Ключ POLLINATIONS_API_KEY живе лише у змінних середовища Netlify.
//
// ВАЖЛИВО (розділ 3 ТЗ): ШІ НЕ повинен писати важливий український текст
// всередині картинки — весь текст (заголовок, дата, хештег) накладає сайт
// поверх зображення. Тому промпт явно забороняє будь-які літери й слова
// на зображенні, а фронтенд завжди рендерить AI-картинку як фон під
// текстовими шарами превʼю, а не разом із текстом.
//
// POST /.netlify/functions/generate-image
//   body { templateName, templateDescription, fields }
//   -> 200 { imageData: "data:image/png;base64,..." }
//   -> 500 { error }  зрозуміле повідомлення, без stack trace користувачу

const { requireRole } = require('../lib/auth');

const IMAGE_MODEL = 'flux';

function buildPrompt({ templateName, templateDescription, fields }) {
  const f = fields || {};
  const topic = [f.title, f.details, f.idea, f.place, f.mood]
    .filter((v) => v && String(v).trim())
    .join('. ');

  return `Square 1:1 social media background for a friendly Ukrainian technical university student community.
Topic: ${templateName || 'student post'}. Context: ${topic || 'student life, support, community'}.
Modern clean editorial illustration or natural-looking photo, bright blue and white palette with a few warm light accents.
Leave calm negative space in the upper third for a title overlay. Warm, optimistic, energetic, inclusive, no dark mood.
Do not add any written text, letters, numbers, signs, logos, watermarks, flags, emblems, or pseudo-text. The website adds the title and branding separately.`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Та сама політика доступу, що й для генерації тексту: viewer лише дивиться.
  const guard = await requireRole(event, ['owner', 'admin', 'editor']);
  if (!guard.ok) {
    return { statusCode: guard.statusCode, body: JSON.stringify({ error: guard.error }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Некоректний JSON у запиті' }) };
  }

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'POLLINATIONS_API_KEY не налаштовано в Netlify (Site settings → Environment variables).' }),
    };
  }

  if (typeof fetch === 'undefined') {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'У цьому Node-рантаймі немає вбудованого fetch. Потрібен Node 18+ (додай NODE_VERSION у netlify.toml).' }),
    };
  }

  const prompt = buildPrompt(body);

  try {
    const url = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`);
    url.searchParams.set('model', IMAGE_MODEL);
    url.searchParams.set('width', '1024');
    url.searchParams.set('height', '1024');
    url.searchParams.set('seed', String(Math.floor(Math.random() * 1_000_000_000)));
    url.searchParams.set('nologo', 'true');

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      console.error('Pollinations image API error:', response.status, details);
      const message = response.status === 401
        ? 'Ключ Pollinations невалідний або не налаштований.'
        : response.status === 402
          ? 'У Pollinations вичерпано безкоштовний ліміт для цього ключа.'
          : 'ШІ-сервіс зображень зараз недоступний. Спробуйте ще раз трохи пізніше.';
      return { statusCode: response.status, body: JSON.stringify({ error: message }) };
    }

    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    if (!mimeType.startsWith('image/')) {
      console.error('Pollinations returned a non-image response:', mimeType);
      return { statusCode: 502, body: JSON.stringify({ error: 'ШІ не повернув зображення. Спробуйте ще раз.' }) };
    }

    const imageBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    const imageData = `data:${mimeType};base64,${imageBase64}`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData }),
    };
  } catch (err) {
    console.error('generate-image function crashed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Не вдалося згенерувати зображення. Спробуйте ще раз трохи пізніше.' }),
    };
  }
};
