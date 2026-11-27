import { APP_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { withBasePath } from '@/config/base-path';

export function StoreHolding() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex max-w-lg flex-col gap-3">
        <Typography as="h1" size="lg" className="text-3xl font-bold">
          This shop is being set up
        </Typography>
        <Typography as="p" className="text-muted-foreground">
          The owner has not finished setting up this shop yet. Please check back soon.
        </Typography>
      </div>
      <Button asChild variant="secondary">
        <a href={withBasePath(APP_ROUTES.SETUP)}>Merchant setup</a>
      </Button>
    </main>
  );
}
