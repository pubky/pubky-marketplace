import { Metadata } from '@/molecules/Metadata/Metadata';
import { CompleteProfile } from '@/templates/Account/CompleteProfile/CompleteProfile';

export const metadata = Metadata({
  title: 'Complete profile',
  description: 'Complete the profile for your existing Pubky account.',
});

export default function Page() {
  return <CompleteProfile />;
}
