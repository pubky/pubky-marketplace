import { getBasePath } from '@/config/base-path';
import { passportCallbackHtml } from '@/libs/passport/passport-callback';

export function GET() {
  return new Response(passportCallbackHtml(getBasePath()), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
