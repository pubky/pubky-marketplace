import { getSiteName } from '@/config/metadata';
import { Metadata } from '@/molecules/Metadata/Metadata';

export function generateMetadata() {
  return Metadata({
    title: `Offline - ${getSiteName()}`,
    description: 'You are currently offline.',
    robots: false,
  });
}

export default function Offline() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-2xl font-bold">You&apos;re offline</h2>
      <p className="text-muted-foreground">Please check your internet connection and try again.</p>
    </div>
  );
}
