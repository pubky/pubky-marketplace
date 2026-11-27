import { getSiteName } from '@/config/metadata';
import { Metadata } from '@/molecules/Metadata/Metadata';

export { NotFound as default } from '@/templates/Public/NotFound/NotFound';

export function generateMetadata() {
  return Metadata({
    title: `Page Not Found - ${getSiteName()}`,
    description: 'The page you are looking for does not exist.',
    robots: false,
  });
}
