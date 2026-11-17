import { Suspense } from 'react';
import { Container } from '@/atoms/Container/Container';
import { Spinner } from '@/atoms/Spinner/Spinner';
import { getSiteName } from '@/config/metadata';
import { Metadata } from '@/molecules/Metadata/Metadata';
import { ShareTarget } from '@/templates/Feed/ShareTarget/ShareTarget';

export function generateMetadata() {
  return Metadata({
    title: `Share to ${getSiteName()}`,
    description: `Share content to ${getSiteName()}.`,
    robots: false,
  });
}

function ShareLoadingFallback() {
  return (
    <Container className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </Container>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<ShareLoadingFallback />}>
      <ShareTarget />
    </Suspense>
  );
}
