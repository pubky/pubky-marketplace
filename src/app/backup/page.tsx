import { Metadata } from '@/molecules/Metadata/Metadata';
import { BackupPage } from '@/templates/Account/BackupPage/BackupPage';

export const metadata = Metadata({
  title: 'Back up saved keys',
  description: 'Back up legacy identity keys saved in this browser.',
});

export default function Page() {
  return <BackupPage />;
}
