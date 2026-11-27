import { Typography } from '@/atoms/Typography/Typography';

export function StoreUnavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <Typography as="h1" size="lg" className="text-3xl font-bold">
        This shop is temporarily unavailable
      </Typography>
      <Typography as="p" className="text-muted-foreground">
        Please check back soon.
      </Typography>
    </main>
  );
}
