/// <reference lib="webworker" />

import { type PrecacheEntry, Serwist, type SerwistGlobalConfig } from 'serwist';
import { buildRuntimeCaching } from './sw.routes';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Installed OS share targets can outlive the manifest. Reject old shares locally
// so their files never leave the device when the old OS entry is used.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' || new URL(self.registration.scope).pathname !== '/') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === '/share') {
    event.respondWith(new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } }));
  }
});

// The retired OS share target accepted POST /share only at the origin root.
// The App uses the same cache name for its own shares on mounted Shop deployments.
self.addEventListener('activate', (event) => {
  if (new URL(self.registration.scope).pathname === '/') {
    event.waitUntil(self.caches.delete('share-target-files'));
  }
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: buildRuntimeCaching(),
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();
