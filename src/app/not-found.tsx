import { getSiteName } from '@/config/metadata';
import { Metadata } from '@/molecules/Metadata/Metadata';

export function generateMetadata() {
  return Metadata({
    title: `Page Not Found - ${getSiteName()}`,
    description: 'The page you are looking for does not exist.',
    robots: false,
  });
}

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold">Not Found</h2>
      <p>Could not find requested resource</p>
    </div>
  );
}
