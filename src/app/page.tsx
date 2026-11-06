import { redirect } from 'next/navigation';
import { APP_ROUTES } from '@/app/routes';

export default function RootPage() {
  redirect(APP_ROUTES.MARKETPLACE);
}
