const CACHE_NAME = 'pedicab-v1';
const ASSETS = [
    '/',
    '/commuter/signin.html',
    '/commuter/signup.html',
    '/commuter/app.html',
    '/driver/app.html',
    '/shared/css/style.css',
    '/shared/js/config/supabase-config.js',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
