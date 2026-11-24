/** @vitest-environment node */
// FormData, File and Request must come from one implementation for a multipart POST to parse.
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST_SUPPORTED_ATTACHMENT_MIME_TYPES } from '@/config/posts';
import { asOpaque } from '@/test-utils/type-assertions';
import {
  composeShareContent,
  getSharedFiles,
  handleShareTarget,
  refusedFileCount,
  sharedFileType,
} from './shareTarget';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=1"><rect width="1" height="1"/></svg>';
const HTML = '<!doctype html><html><body><script>document.title = 1</script></body></html>';

function cacheKey(request: RequestInfo | URL): string {
  const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  return new URL(url, 'http://localhost').href;
}

/** The parts of the Cache API the share target uses, kept in memory. */
class MemoryCache {
  readonly entries = new Map<string, Response>();

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(cacheKey(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(cacheKey(request), response);
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(cacheKey(request));
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();
  failOpen = false;

  async open(name: string): Promise<MemoryCache> {
    if (this.failOpen) throw new Error('Cache unavailable');
    const existing = this.stores.get(name);
    if (existing) return existing;
    const cache = new MemoryCache();
    this.stores.set(name, cache);
    return cache;
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

async function image(format: 'png' | 'jpeg' | 'gif' | 'webp' | 'avif'): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#0a78c8' } })
    .toFormat(format)
    .toBuffer();
  return new Uint8Array(buffer);
}

/** A complete 8 kHz mono 16-bit PCM WAV file holding 8 samples of silence. */
function wavFile(): Uint8Array<ArrayBuffer> {
  const file = new Uint8Array(60);
  const view = new DataView(file.buffer);
  const ascii = (text: string, offset: number) => file.set(new TextEncoder().encode(text), offset);
  ascii('RIFF', 0);
  view.setUint32(4, file.length - 8, true);
  ascii('WAVEfmt ', 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii('data', 36);
  view.setUint32(40, 16, true);
  return file;
}

/**
 * A file whose declared type keeps its case and parameters, as Chromium's
 * multipart parser hands it over; Node's and Firefox's lowercase it.
 */
function chromiumFile(bits: BlobPart[], name: string, type: string): File {
  const file = new File(bits, name);
  Object.defineProperty(file, 'type', { value: type });
  return file;
}

/** A share POST whose form data is already parsed, so file types reach the handler as given. */
function parsedSharePost(files: readonly File[]): Request {
  const form = new FormData();
  for (const file of files) form.append('media', file);
  const request = new Request('http://localhost:3000/share', { method: 'POST' });
  Object.defineProperty(request, 'formData', { value: async () => form });
  return request;
}

/** A multipart POST to /share, as a share sheet or any other page's form would send it. */
function sharePost(files: readonly File[], fields: Record<string, string> = {}, origin?: string): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  for (const file of files) form.append('media', file);
  return new Request('http://localhost:3000/share', {
    method: 'POST',
    body: form,
    headers: origin ? { origin } : {},
  });
}

describe('shareTarget utilities', () => {
  let storage: MemoryCacheStorage;
  const originalCaches = globalThis.caches;

  beforeEach(() => {
    storage = new MemoryCacheStorage();
    Object.defineProperty(globalThis, 'caches', { value: storage, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'caches', { value: originalCaches, writable: true, configurable: true });
  });

  const cacheStorage = () => asOpaque<CacheStorage>(storage);
  const cachedTypes = () =>
    Promise.all(
      [...(storage.stores.get('share-target-files')?.entries.values() ?? [])].map((response) =>
        response.headers.get('Content-Type'),
      ),
    );

  describe('sharedFileType', () => {
    it.each([
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['gif', 'image/gif'],
      ['webp', 'image/webp'],
      ['avif', 'image/avif'],
    ] as const)('types a real %s image from its bytes, whatever was declared', async (format, type) => {
      await expect(sharedFileType(new Blob([await image(format)], { type: 'text/html' }))).resolves.toBe(type);
    });

    it.each([
      ['image/svg+xml', SVG],
      ['image/png', SVG],
      ['image/png,text/html', HTML],
      ['image/x,image/svg+xml', SVG],
      ['text/html', HTML],
      ['application/xml', '<?xml version="1.0"?><root/>'],
      ['text/xml', '<?xml version="1.0"?><root/>'],
      ['application/octet-stream', HTML],
      ['audio/x-unknown', HTML],
    ])('refuses a file declared as %s whose bytes are not a raster image', async (type, body) => {
      await expect(sharedFileType(new Blob([body], { type }))).resolves.toBeNull();
    });

    it('refuses video/mp4,text/html as Node and Firefox hand it over; Chromium hands over video/mp4, an exact kept type', async () => {
      await expect(sharedFileType(new Blob([HTML], { type: 'video/mp4,text/html' }))).resolves.toBeNull();
      await expect(sharedFileType(new Blob([HTML], { type: 'video/mp4' }))).resolves.toBe('video/mp4');
    });

    it.each(['audio/mpeg', 'audio/wav', 'video/mp4'])('keeps %s, which the composer accepts', async (type) => {
      expect(POST_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain(type);
      await expect(sharedFileType(new Blob([wavFile()], { type }))).resolves.toBe(type);
    });

    it.each(['audio/ogg', 'audio/webm', 'video/webm', 'video/ogg'])(
      'refuses the manifest type %s, which the composer does not accept',
      async (type) => {
        expect(POST_SUPPORTED_ATTACHMENT_MIME_TYPES).not.toContain(type);
        await expect(sharedFileType(new Blob([wavFile()], { type }))).resolves.toBeNull();
      },
    );

    it.each([
      ['VIDEO/MP4', 'video/mp4'],
      ['video/mp4; codecs=avc1', 'video/mp4'],
      ['Audio/WAV ;rate=8000', 'audio/wav'],
      ['audio/MPEG', 'audio/mpeg'],
    ])('keeps %s as Chromium hands it over, under its essence %s', async (declared, type) => {
      await expect(sharedFileType(chromiumFile([wavFile()], 'clip', declared))).resolves.toBe(type);
    });

    it.each(['VIDEO/WEBM', 'video/mp4x; codecs=avc1', 'text/html; charset=video/mp4'])(
      'refuses %s as Chromium hands it over',
      async (declared) => {
        await expect(sharedFileType(chromiumFile([HTML], 'clip', declared))).resolves.toBeNull();
      },
    );
  });

  describe('handleShareTarget', () => {
    it('caches a real image under the type of its bytes and redirects to /share', async () => {
      const png = await image('png');

      const response = await handleShareTarget(
        sharePost([new File([png], 'photo.png', { type: 'text/html' })], { text: 'Look' }),
        cacheStorage(),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('http://localhost:3000/share?text=Look&hasFiles=true');
      await expect(cachedTypes()).resolves.toEqual(['image/png']);
    });

    it('refuses SVG, HTML and XML POSTed from another site before caching them', async () => {
      const response = await handleShareTarget(
        sharePost(
          [
            new File([SVG], 'cat.svg', { type: 'image/svg+xml' }),
            new File([HTML], 'page.html', { type: 'text/html' }),
            new File(['<?xml version="1.0"?><root/>'], 'data.xml', { type: 'application/xml' }),
          ],
          {},
          'https://other.example',
        ),
        cacheStorage(),
      );

      expect(response.headers.get('location')).toBe('http://localhost:3000/share?refusedFiles=3');
      await expect(cachedTypes()).resolves.toEqual([]);
    });

    it('keeps the images and media of a mixed share and counts what it refused', async () => {
      const response = await handleShareTarget(
        sharePost([
          new File([await image('jpeg')], 'a.jpg', { type: 'image/jpeg' }),
          new File([SVG], 'b.svg', { type: 'image/svg+xml' }),
          new File([wavFile()], 'c.wav', { type: 'audio/wav' }),
        ]),
        cacheStorage(),
      );

      expect(response.headers.get('location')).toBe('http://localhost:3000/share?hasFiles=true&refusedFiles=1');
      await expect(cachedTypes()).resolves.toEqual(['image/jpeg', 'audio/wav']);
      expect([...(storage.stores.get('share-target-files')?.entries.keys() ?? [])]).toEqual([
        'http://localhost/share-target-file/0',
        'http://localhost/share-target-file/1',
      ]);
    });

    it('caches audio and video Chromium hands over under the essence of their type', async () => {
      const response = await handleShareTarget(
        parsedSharePost([
          chromiumFile([wavFile()], 'clip.mp4', 'VIDEO/MP4'),
          chromiumFile([wavFile()], 'clip2.mp4', 'video/mp4; codecs=avc1'),
          chromiumFile([wavFile()], 'clip.webm', 'Video/WebM'),
        ]),
        cacheStorage(),
      );

      expect(response.headers.get('location')).toBe('http://localhost:3000/share?hasFiles=true&refusedFiles=1');
      await expect(cachedTypes()).resolves.toEqual(['video/mp4', 'video/mp4']);
    });

    it('drops the files of an earlier share', async () => {
      await handleShareTarget(
        sharePost([new File([await image('png')], 'old.png'), new File([await image('jpeg')], 'old.jpg')]),
        cacheStorage(),
      );
      await handleShareTarget(sharePost([new File([await image('gif')], 'new.gif')]), cacheStorage());

      await expect(cachedTypes()).resolves.toEqual(['image/gif']);
    });

    it('keeps file names outside Latin-1 through the cache', async () => {
      const names = ['写真 2026.png', 'фото.jpg', '100% café 🎉.gif'];
      const response = await handleShareTarget(
        sharePost([
          new File([await image('png')], names[0], { type: 'image/png' }),
          new File([await image('jpeg')], names[1], { type: 'image/jpeg' }),
          new File([await image('gif')], names[2], { type: 'image/gif' }),
        ]),
        cacheStorage(),
      );

      expect(response.headers.get('location')).toBe('http://localhost:3000/share?hasFiles=true');
      const files = await getSharedFiles();
      expect(files.map((file) => [file.name, file.type])).toEqual([
        [names[0], 'image/png'],
        [names[1], 'image/jpeg'],
        [names[2], 'image/gif'],
      ]);
    });

    it('drops the files of an earlier share on a text-only share', async () => {
      await handleShareTarget(sharePost([new File([await image('png')], 'old.png')]), cacheStorage());

      const response = await handleShareTarget(
        sharePost([], { title: 'T', url: 'https://example.com' }),
        cacheStorage(),
      );

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/share?title=T&url=https%3A%2F%2Fexample.com',
      );
      expect(storage.stores.size).toBe(0);
      await expect(getSharedFiles()).resolves.toEqual([]);
    });

    it('hands the share page only files typed from their bytes', async () => {
      const png = await image('png');
      await handleShareTarget(
        sharePost(
          [new File([png], 'photo.png', { type: 'image/png' }), new File([SVG], 'cat.svg', { type: 'image/svg+xml' })],
          {},
          'https://other.example',
        ),
        cacheStorage(),
      );

      const files = await getSharedFiles();

      expect(files.map((file) => [file.name, file.type])).toEqual([['photo.png', 'image/png']]);
      expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(png);
      expect(storage.stores.has('share-target-files')).toBe(false);
    });
  });

  describe('getSharedFiles', () => {
    async function cacheEntry(body: BodyInit, headers: Record<string, string>) {
      const cache = await storage.open('share-target-files');
      await cache.put(`/share-target-file/${cache.entries.size}`, new Response(body, { headers }));
    }

    it('returns empty array when cache has no files', async () => {
      await expect(getSharedFiles()).resolves.toEqual([]);
    });

    it('retrieves files from cache and returns them', async () => {
      await cacheEntry(await image('png'), { 'X-Share-Filename': 'test-image.png', 'Content-Type': 'image/png' });

      const files = await getSharedFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(File);
      expect(files[0].name).toBe('test-image.png');
      expect(files[0].type).toBe('image/png');
    });

    it('uses fallback filename when X-Share-Filename header is missing', async () => {
      await cacheEntry(await image('jpeg'), { 'Content-Type': 'image/jpeg' });

      const files = await getSharedFiles();

      expect(files.map((file) => file.name)).toEqual(['shared-file']);
    });

    it('uses fallback filename when X-Share-Filename is empty', async () => {
      await cacheEntry(await image('png'), { 'X-Share-Filename': '', 'Content-Type': 'image/png' });

      const files = await getSharedFiles();

      expect(files.map((file) => file.name)).toEqual(['shared-file']);
    });

    it('uses fallback filename when X-Share-Filename is not a valid encoding', async () => {
      await cacheEntry(await image('png'), { 'X-Share-Filename': 'photo%E0%A4%A.png', 'Content-Type': 'image/png' });

      const files = await getSharedFiles();

      expect(files.map((file) => file.name)).toEqual(['shared-file']);
    });

    it('types an image from its bytes when the Content-Type header is missing', async () => {
      await cacheEntry(await image('webp'), { 'X-Share-Filename': 'photo.webp' });

      const files = await getSharedFiles();

      expect(files.map((file) => file.type)).toEqual(['image/webp']);
    });

    it('refuses an SVG or HTML entry an older service worker cached', async () => {
      await cacheEntry(SVG, { 'X-Share-Filename': 'cat.svg', 'Content-Type': 'image/svg+xml' });
      await cacheEntry(HTML, { 'X-Share-Filename': 'page.png', 'Content-Type': 'image/png' });
      await cacheEntry(await image('gif'), { 'X-Share-Filename': 'ok.gif', 'Content-Type': 'image/gif' });

      const files = await getSharedFiles();

      expect(files.map((file) => [file.name, file.type])).toEqual([['ok.gif', 'image/gif']]);
    });

    it('handles multiple files in cache', async () => {
      await cacheEntry(await image('png'), { 'X-Share-Filename': 'image.png', 'Content-Type': 'image/png' });
      await cacheEntry(wavFile(), { 'X-Share-Filename': 'clip.wav', 'Content-Type': 'audio/wav' });

      const files = await getSharedFiles();

      expect(files.map((file) => [file.name, file.type])).toEqual([
        ['image.png', 'image/png'],
        ['clip.wav', 'audio/wav'],
      ]);
    });

    it('clears cache after retrieval', async () => {
      await cacheEntry(await image('png'), { 'X-Share-Filename': 'test.png', 'Content-Type': 'image/png' });

      await getSharedFiles();

      expect(storage.stores.has('share-target-files')).toBe(false);
    });

    it('returns empty array on error', async () => {
      storage.failOpen = true;

      await expect(getSharedFiles()).resolves.toEqual([]);
    });
  });

  describe('refusedFileCount', () => {
    it.each([
      ['1', 1],
      ['3', 3],
      ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ])('reads %s as %i', (value, count) => {
      expect(refusedFileCount(value)).toBe(count);
    });

    it.each([null, '', '0', '-1', '1.5', '1e3', '0x10', 'Infinity', ' 2', '2 ', 'abc', '9007199254740992'])(
      'reads %s as no refused files',
      (value) => {
        expect(refusedFileCount(value)).toBe(0);
      },
    );
  });

  describe('composeShareContent', () => {
    it('returns empty string when no params provided', () => {
      const result = composeShareContent({});

      expect(result).toBe('');
    });

    it('returns text only when only text is provided', () => {
      const result = composeShareContent({ text: 'Hello world' });

      expect(result).toBe('Hello world');
    });

    it('returns url only when only url is provided', () => {
      const result = composeShareContent({ url: 'https://example.com' });

      expect(result).toBe('https://example.com');
    });

    it('returns title when only title is provided', () => {
      const result = composeShareContent({ title: 'Page Title' });

      expect(result).toBe('Page Title');
    });

    it('combines text and url with double newline', () => {
      const result = composeShareContent({
        text: 'Check this out',
        url: 'https://example.com',
      });

      expect(result).toBe('Check this out\n\nhttps://example.com');
    });

    it('does not duplicate url if already in text', () => {
      const result = composeShareContent({
        text: 'Check out https://example.com',
        url: 'https://example.com',
      });

      expect(result).toBe('Check out https://example.com');
    });

    it('ignores title when text is provided', () => {
      const result = composeShareContent({
        title: 'Page Title',
        text: 'The actual content',
      });

      expect(result).toBe('The actual content');
    });

    it('ignores title when url is provided', () => {
      const result = composeShareContent({
        title: 'Page Title',
        url: 'https://example.com',
      });

      expect(result).toBe('https://example.com');
    });

    it('handles typical browser share (title + url)', () => {
      const result = composeShareContent({
        title: 'Interesting Article - News Site',
        url: 'https://news.example.com/article/123',
      });

      expect(result).toBe('https://news.example.com/article/123');
    });

    it('handles social app share (text + url)', () => {
      const result = composeShareContent({
        text: 'This is amazing! 🎉',
        url: 'https://social.example.com/post/456',
      });

      expect(result).toBe('This is amazing! 🎉\n\nhttps://social.example.com/post/456');
    });

    it('handles note app share (text only)', () => {
      const result = composeShareContent({
        text: 'Selected text from a document that the user wants to share.',
      });

      expect(result).toBe('Selected text from a document that the user wants to share.');
    });

    it('handles all params with url not in text', () => {
      const result = composeShareContent({
        title: 'Page Title',
        text: 'Some description',
        url: 'https://example.com',
      });

      expect(result).toBe('Some description\n\nhttps://example.com');
    });

    it('handles all params with url already in text', () => {
      const result = composeShareContent({
        title: 'Page Title',
        text: 'Check this: https://example.com',
        url: 'https://example.com',
      });

      expect(result).toBe('Check this: https://example.com');
    });
  });
});
