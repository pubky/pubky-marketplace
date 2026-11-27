import { buildStoreClaimCodeIntakeScript } from '@/libs/store-claim/store-claim-code';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script id="store-claim-code-intake" dangerouslySetInnerHTML={{ __html: buildStoreClaimCodeIntakeScript() }} />
      {children}
    </>
  );
}
