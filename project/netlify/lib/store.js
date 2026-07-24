// netlify/lib/store.js
//
// Спільна обгортка над Netlify Blobs для всіх функцій (drafts, events, users…).
//
// Проблема, яку це вирішує: getStore('name') без параметрів покладається на
// те, що Netlify сам підставить siteID і token у середовище функції. У теорії
// це має працювати "з коробки", але на практиці іноді не спрацьовує навіть
// у проді (MissingBlobsEnvironmentError) — відома історія на форумі Netlify.
//
// Тому тут ми підключаємось ЯВНО через BLOBS_SITE_ID і BLOBS_TOKEN
// (Site settings → Environment variables у Netlify), а на автоматичний
// контекст покладаємось лише як на запасний варіант.

const { getStore } = require('@netlify/blobs');

function openStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({ name, siteID, token });
  }

  // Фолбек: автоматичний контекст Netlify (працює в `netlify dev`,
  // і має працювати в проді, якщо BLOBS_SITE_ID/BLOBS_TOKEN не задані).
  return getStore(name);
}

module.exports = { openStore };
