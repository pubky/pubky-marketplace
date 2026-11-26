/// <reference lib="webworker" />

import { type PrecacheEntry, Serwist, type SerwistGlobalConfig } from 'serwist';
import { handleShareTarget } from '@/libs/share/shareTarget';
import { buildRuntimeCaching } from './sw.routes';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Register the share target handler before Serwist to intercept POST to /share
self.addEventListener('fetch', (event: FetchEvent) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request, self.caches));
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
