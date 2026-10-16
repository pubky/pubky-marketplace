import { Image } from '@/atoms/Image/Image';
import { Link } from '@/atoms/Link/Link';
import { cn } from '@/libs/utils/utils';

export function BitkitDownloads({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'grid w-full grid-cols-3 items-center',
        compact ? 'max-w-[19.6rem] gap-[0.525rem]' : 'max-w-md gap-3',
      )}
      role="group"
      aria-label="Get Bitkit"
    >
      <Link
        href="https://www.bitkit.to/"
        overrideDefaults
        className="min-w-0 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Image src="/images/bitkit/logo.svg" alt="Bitkit" width={164} height={48} className="w-full" />
      </Link>
      <Link
        href="https://get.bitkit.to/iOS"
        overrideDefaults
        className="min-w-0 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Image
          src="/images/bitkit/app-store.png"
          alt="Download Bitkit on the App Store"
          width={828}
          height={246}
          className="w-full"
        />
      </Link>
      <Link
        href="https://get.bitkit.to/PlayStore"
        overrideDefaults
        className="min-w-0 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Image
          src="/images/bitkit/google-play.png"
          alt="Get Bitkit on Google Play"
          width={828}
          height={247}
          className="w-full"
        />
      </Link>
    </div>
  );
}
