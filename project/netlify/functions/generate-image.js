// netlify/functions/generate-image.js
//
// Генерація фонового зображення для превʼю поста через Google Gemini
// (модель gemini-2.5-flash-image, вона ж "Nano Banana", той самий
// безкоштовний тариф, що й generate-text.js). Ключ GEMINI_API_KEY живе
// тільки тут, на сервері.
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

const IMAGE_MODEL = 'gemini-3.6-flash-image';

function buildPrompt({ templateName, templateDescription, fields }) {
  const f = fields || {};
  const topic = [f.title, f.details, f.idea, f.place, f.mood]
    .filter((v) => v && String(v).trim())
    .join('. ');

  return `Створи один привабливий, теплий ілюстративний фон для банера студентської
спільноти українського технічного університету.

Тема поста: "${templateName || 'пост'}"${templateDescription ? ` (${templateDescription})` : ''}.
Контекст без вигаданих фактів, лише як натхнення для настрою і композиції: ${topic || 'студентське життя, підтримка, спільнота'}.

Стиль:
- сучасна плоска/напівплоска ілюстрація або світлина в теплих, дружніх, енергійних кольорах;
- основний акцент — синьо-блакитна гама з теплими світлими вставками;
- квадратна композиція 1:1, підходить як фон для банера в соцмережах;
- достатньо порожнього/спокійного простору у верхній третині кадру, щоб потім поверх накласти заголовок;
- без політичних символів, без прапорів як домінантного елемента (якщо не свято);
- доброзичливо, без насильства, без тривожних чи шокуючих образів.

СУВОРА ВИМОГА: зображення НЕ повинно містити жодного тексту, літер, цифр, підписів,
логотипів, водяних знаків чи псевдотексту. Жодних слів на зображенні взагалі —
весь текст додається окремо поверх картинки на сайті.`;
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY не налаштовано в Netlify (Site settings → Environment variables).' }),
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini image API error:', JSON.stringify(data));
      const message =
        (data && data.error && data.error.message) ||
        'ШІ-сервіс зображень зараз недоступний. Спробуйте ще раз трохи пізніше.';
      return { statusCode: response.status, body: JSON.stringify({ error: message }) };
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);

    if (!imagePart) {
      console.error('Gemini image API: no inlineData in response', JSON.stringify(data));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'ШІ не повернув зображення. Спробуйте перегенерувати ще раз.' }),
      };
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const imageData = `data:${mimeType};base64,${imagePart.inlineData.data}`;

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
