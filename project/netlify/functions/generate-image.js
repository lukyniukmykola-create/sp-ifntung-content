const { requireRole } = require('../lib/auth');

const IMAGE_WORKER_URL = process.env.CLOUDFLARE_IMAGE_WORKER_URL;
const IMAGE_WORKER_KEY = process.env.CLOUDFLARE_IMAGE_WORKER_KEY;

function buildPrompt({ templateName, fields }) {
  const f = fields || {};
  const topic = [f.title, f.details, f.idea, f.place, f.mood]
    .filter((value) => value && String(value).trim())
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

  const guard = await requireRole(event, ['owner', 'admin', 'editor']);
  if (!guard.ok) {
    return { statusCode: guard.statusCode, body: JSON.stringify({ error: guard.error }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON request.' }) };
  }

  if (!IMAGE_WORKER_URL || !IMAGE_WORKER_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Cloudflare image generator is not configured in Netlify.' }),
    };
  }

  try {
    const response = await fetch(IMAGE_WORKER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${IMAGE_WORKER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: buildPrompt(body) }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.image) {
      console.error('Cloudflare image worker error:', response.status, result);
      return {
        statusCode: response.status || 502,
        body: JSON.stringify({ error: result.error || 'Image generator is temporarily unavailable.' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: result.image }),
    };
  } catch (error) {
    console.error('Cloudflare image worker request failed:', error);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Could not reach the image generator.' }),
    };
  }
};
