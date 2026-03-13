// sw.js - Service Worker para PWA
const CACHE_NAME = 'bjj-app-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instalación: cachear archivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Cache abierto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Estrategia: Network First, fallback a cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Para peticiones API: SIEMPRE red, NUNCA cache
  if (url.pathname.startsWith('/api/') || url.hostname.includes('onrender.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => response)
        .catch(error => {
          console.log('❌ Error fetching API:', error);
          return new Response(JSON.stringify({ error: 'Sin conexión al servidor' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Para archivos estáticos: cache first (el resto igual)
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(response => {
          // Solo cachear respuestas exitosas de archivos estáticos
          if (!response || response.status !== 200 || !response.url.match(/\.(html|css|js|png|jpg|svg|ico)$/)) {
            return response;
          }
          
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          
          return response;
        });
      })
  );
});