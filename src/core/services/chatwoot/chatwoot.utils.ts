import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CHATWOOT_CLAIMED_NAME_LABEL, CHATWOOT_CLAIMED_REPORTER_LABEL } from './chatwoot.constants';
import type { TChatwootContact } from './chatwoot.types';

/**
 * Email domain for Chatwoot contacts
 */
export const CHATWOOT_EMAIL_DOMAIN = 'pubky.app';

/**
 * Build email address from pubky for Chatwoot contact
 *
 * @param pubky - User's public key
 * @returns Email address in format pubky@pubky.app
 */
export function buildChatwootEmail(pubky: string): string {
  return `${pubky}@${CHATWOOT_EMAIL_DOMAIN}`;
}

/**
 * Collapse every run of whitespace, line breaks included, into one space
 *
 * `\s` covers \r, \n, tabs and the Unicode line/paragraph separators
 * (U+2028, U+2029); U+0085 (next line) is added because `\s` omits it.
 *
 * @param value - Free-text value
 * @returns The value on a single line, trimmed
 */
function toSingleLine(value: string): string {
  return value.replace(/[\s\u0085]+/g, ' ').trim();
}

/**
 * Build the claimed reporter lines for a support message
 *
 * The pubky and name come from the request body and are not checked against a
 * session, so both are labelled as claimed and unverified. Each value is
 * collapsed onto one line so it stays on its own labelled line.
 *
 * @param pubky - Submitter's claimed public key
 * @param name - Submitter's claimed display name
 * @returns Two labelled lines joined by a newline
 */
export function buildClaimedReporterLines(pubky: string, name: string): string {
  return [
    `${CHATWOOT_CLAIMED_REPORTER_LABEL}: ${toSingleLine(pubky)}`,
    `${CHATWOOT_CLAIMED_NAME_LABEL}: ${toSingleLine(name)}`,
  ].join('\n');
}

/**
 * Extract source ID from contact, validating inbox associations exist
 *
 * Validates that the contact has at least one inbox association and
 * returns the source ID from the first inbox.
 *
 * @param contact - Chatwoot contact object
 * @param email - Email used for error context
 * @returns Source ID from the first inbox association
 * @throws AppError if contact has no inbox associations
 */
export function extractSourceId(contact: TChatwootContact, email: string): string {
  if (!contact.contact_inboxes || contact.contact_inboxes.length === 0) {
    throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Contact has no inbox associations', {
      service: ErrorService.Chatwoot,
      operation: 'extractSourceId',
      context: { contactId: contact.id, email },
    });
  }
  return contact.contact_inboxes[0].source_id;
}
