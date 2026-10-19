'use client';

import { FooterLinks } from '@/atoms/FooterLinks/FooterLinks';
import { Link } from '@/atoms/Link/Link';
import { COMPLAINT_EMAIL, LEGAL_ENTITY_NAME } from '@/config/legal';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { DialogPrivacy } from '@/organisms/DialogPrivacy/DialogPrivacy';
import { DialogTerms } from '@/organisms/DialogTerms/DialogTerms';

/**
 * Legal information for the embedded Shop. Embedded, the host app owns the page chrome, so the
 * Shop's own footer is not rendered; this strip keeps the Terms, the Privacy Policy, the
 * contracting entity, the complaint contact and the way to report a listing on every Shop page.
 * A top-level Shop renders nothing: the Terms, Privacy Policy and entity are in its Settings.
 */
export function EmbeddedLegalFooter() {
  const isEmbedded = useIsEmbedded();
  if (!isEmbedded) return null;

  return (
    <footer
      aria-label="Legal"
      data-testid="embedded-legal-footer"
      className="m-auto flex w-full max-w-(--container-max-width) flex-col gap-1 px-6 pt-2 pb-8 xl:px-0"
    >
      <FooterLinks>
        {`Pubky Shop is provided by ${LEGAL_ENTITY_NAME} · `}
        <DialogTerms />
        {' · '}
        <DialogPrivacy />
      </FooterLinks>
      <FooterLinks>
        {'Complaints: '}
        <Link href={`mailto:${COMPLAINT_EMAIL}`}>{COMPLAINT_EMAIL}</Link>
        {' · To report a listing, open it and choose Report listing.'}
      </FooterLinks>
    </footer>
  );
}
