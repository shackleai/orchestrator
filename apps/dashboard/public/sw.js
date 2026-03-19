/// <reference lib="webworker" />

const CACHE_NAME = 'shackleai-shell-v1'

/** App shell files to cache for offline support. */
const SHELL_FILES = [
  '/',
  '/index.html',
]

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)),
  )
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  // Take control of all open tabs immediately
  self.clients.claim()
})

// Fetch: network-first strategy for API calls, cache-first for shell
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // API calls: always go to network (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) return

  // Navigation requests: serve from cache, fall back to network
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r || fetch(request)),
      ),
    )
    return
  }

  // Static assets: cache-first, fall back to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (url.pathname.match(/\.(js|css|woff2?|png|svg|ico)$/))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    }),
  )
})
