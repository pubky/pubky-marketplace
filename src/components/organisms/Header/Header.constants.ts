import { ACCOUNT_ROUTES, AUTH_ROUTES } from '@/app/routes';

export const pathToTitle: Record<string, string> = {
  [ACCOUNT_ROUTES.COMPLETE_PROFILE]: 'Complete profile',
  [AUTH_ROUTES.LOGOUT]: 'Signed out',
};
