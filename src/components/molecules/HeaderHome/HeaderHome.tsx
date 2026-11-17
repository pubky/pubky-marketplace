'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { AUTH_ROUTES, getShopHomeRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { HeaderSocialLinks } from '../Header/Header';
import { HeaderButtonSignIn } from '../HeaderButtonSignIn/HeaderButtonSignIn';

export const HeaderHome = ({ ...props }: HTMLAttributes<HTMLDivElement>) => {
  const router = useRouter();
  const pathname = usePathname();
  const isLogoutPage = pathname === AUTH_ROUTES.LOGOUT;

  const handleExplore = () => {
    router.push(getShopHomeRoute());
  };

  if (isLogoutPage) {
    return (
      <Container className="flex-1 flex-row items-center justify-end gap-3" {...props}>
        <Button
          id="header-explore-btn"
          data-testid="header-explore-btn"
          variant="outline"
          onClick={handleExplore}
          className="hidden gap-2 md:inline-flex"
        >
          <Eye className="size-4" />
          {'Explore'}
        </Button>
        <HeaderButtonSignIn />
      </Container>
    );
  }

  return (
    <Container className="flex-1 flex-row items-center justify-end" {...props}>
      <HeaderSocialLinks />
      <HeaderButtonSignIn />
    </Container>
  );
};
