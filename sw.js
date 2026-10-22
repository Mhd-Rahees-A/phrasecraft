/* PhraseCraft offline app-shell cache.
   The shell can open offline after the first successful installation.
   API translations still require an internet connection. */
'use strict';

const CACHE_NAME = 'phrasecraft-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  // Precache UI libraries so the Markdown renderer is available offline after install.
  'https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache same-origin shell first; CDN failures should not prevent installation.
    await cache.addAll(['./', './index.html', './manifest.json']);
    await Promise.all(APP_SHELL.slice(3).map(async (url) => {
      try {
        const response = await fetch(url, { mode: 'cors', cache: 'reload' });
        if (response.ok && (response.type === 'cors' || response.type === 'basic')) {
          await cache.put(url, response);
        }
      } catch (error) {
        // Online translation still works when libraries are fetched normally.
        console.warn('Optional library precache failed:', url, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('phrasecraft-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API requests or any request containing user content or credentials.
  if (url.hostname === 'api.openai.com' || request.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) {
        // Update the shell quietly in the background when online.
        const networkUpdate = fetch(request).then(async (response) => {
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        }).catch(() => null);
        // Do not wait for the network before returning the cached shell.
        event.waitUntil(networkUpdate);
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('Offline and this resource is not cached.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Cache only the two known static UI libraries; never cache API or arbitrary third-party data.
  if (url.origin === 'https://cdn.jsdelivr.net' &&
      (url.pathname === '/npm/marked@15.0.7/marked.min.js' ||
       url.pathname === '/npm/dompurify@3.2.6/dist/purify.min.js')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return new Response('Library unavailable offline.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
  }
});
