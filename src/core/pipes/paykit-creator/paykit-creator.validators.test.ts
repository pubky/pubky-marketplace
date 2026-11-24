import { describe, expect, it } from 'vitest';
import { HttpStatusCode } from '@/libs/http/http.types';
import { PaykitCreatorValidators } from './paykit-creator.validators';

const PUBKY = 'gy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';

describe('PaykitCreatorValidators.validateSafe', () => {
  it.each([PUBKY, `pubky${PUBKY}`, `  pubky${PUBKY} `])('sends %j in the pubky<z32> form Paykit parses', (creator) => {
    expect(PaykitCreatorValidators.validateSafe(creator)).toEqual({ ok: true, creator: `pubky${PUBKY}` });
  });

  it('keeps a raw key that itself starts with pubky whole', () => {
    const raw = `pubkyb${'o'.repeat(46)}`;
    expect(PaykitCreatorValidators.validateSafe(raw)).toEqual({ ok: true, creator: `pubky${raw}` });
  });

  it.each([null, '', 'pubky', 'not-a-pubky', `${PUBKY}x`, PUBKY.toUpperCase()])('rejects the creator %j', (creator) => {
    expect(PaykitCreatorValidators.validateSafe(creator)).toEqual({
      ok: false,
      message: 'Invalid creator',
      statusCode: HttpStatusCode.BAD_REQUEST,
    });
  });
});
