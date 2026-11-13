'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { AUTH_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';

export function HeaderButtonSignIn({ ...props }: React.HTMLAttributes<HTMLButtonElement>) {
  const router = useRouter();

  const handleClick = () => {
    router.push(AUTH_ROUTES.SIGN_IN);
  };

  return (
    <Button
      id="header-sign-in-btn"
      data-testid="header-sign-in-btn"
      data-cy="header-sign-in-btn"
      variant="secondary"
      onClick={handleClick}
      className="gap-2"
      {...props}
    >
      <LogIn className="size-4" />
      {'Sign in'}
    </Button>
  );
}
