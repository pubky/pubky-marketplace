import type { ReactNode } from 'react';
import { BasePathImage } from '@/atoms/BasePathImage/BasePathImage';
import { SHOPIFY_GUIDE_SCREENSHOTS, type ShopifyGuideScreen } from '@/config/shopify-guide';

const FIGURE_LABELS: Readonly<Record<ShopifyGuideScreen, string>> = {
  admin: 'Shopify admin with Settings, Apps and Develop apps highlighted',
  create: 'Dev Dashboard with the Create app button and the app name Pubky Market',
  configure: 'The app version form with the App URL, redirection URL, scopes and the Release button',
  keys: 'The app Settings page with the Client ID and Client secret fields',
  install: 'The Shopify permission screen with the Install button',
  done: 'A connected store with its permissions and products',
};

/** A drawn browser window: the same frame for every screen. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <rect x="4" y="4" width="312" height="172" rx="10" className="fill-card stroke-border" strokeWidth="1.5" />
      <path d="M4 30h312" className="stroke-border" strokeWidth="1.5" />
      <circle cx="20" cy="17" r="3.5" className="fill-muted-foreground/50" />
      <circle cx="33" cy="17" r="3.5" className="fill-muted-foreground/50" />
      <circle cx="46" cy="17" r="3.5" className="fill-muted-foreground/50" />
      <rect x="66" y="10" width="150" height="14" rx="7" className="fill-background" />
      {children}
    </>
  );
}

function Line({ x, y, width }: { x: number; y: number; width: number }) {
  return <rect x={x} y={y} width={width} height="6" rx="3" className="fill-muted-foreground/40" />;
}

function Field({ y, label, active = false }: { y: number; label: number; active?: boolean }) {
  return (
    <>
      <Line x={120} y={y - 10} width={label} />
      <rect
        x="120"
        y={y}
        width="176"
        height="16"
        rx="4"
        className={active ? 'fill-background stroke-brand' : 'fill-background stroke-border'}
        strokeWidth={active ? 1.8 : 1.2}
      />
    </>
  );
}

function Arrow({ d }: { d: string }) {
  return (
    <path
      d={d}
      className="stroke-brand"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      markerEnd="url(#guide-arrow)"
    />
  );
}

function Sidebar({ highlight }: { highlight?: number }) {
  return (
    <>
      <path d="M92 30v146" className="stroke-border" strokeWidth="1.2" />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect
          key={index}
          x="14"
          y={42 + index * 22}
          width={index === highlight ? 66 : 54}
          height="12"
          rx="6"
          className={index === highlight ? 'fill-brand' : 'fill-muted-foreground/30'}
        />
      ))}
    </>
  );
}

function AdminScreen() {
  return (
    <Frame>
      <Sidebar highlight={4} />
      <rect x="110" y="44" width="190" height="22" rx="6" className="fill-background stroke-border" strokeWidth="1.2" />
      <Line x={120} y={52} width={60} />
      <rect x="110" y="72" width="190" height="22" rx="6" className="fill-background stroke-border" strokeWidth="1.2" />
      <Line x={120} y={80} width={80} />
      <rect x="110" y="100" width="190" height="24" rx="6" className="fill-background stroke-brand" strokeWidth="2" />
      <Line x={120} y={109} width={96} />
      <rect x="232" y="106" width="58" height="12" rx="6" className="fill-brand" />
      <Arrow d="M84 152c14-2 24-8 24-24" />
    </Frame>
  );
}

function CreateScreen() {
  return (
    <Frame>
      <rect x="20" y="44" width="280" height="120" rx="8" className="fill-background stroke-border" strokeWidth="1.2" />
      <Line x={36} y={58} width={110} />
      <Line x={36} y={72} width={170} />
      <rect x="36" y="94" width="180" height="22" rx="5" className="fill-card stroke-brand" strokeWidth="1.8" />
      <text x="46" y="109" className="fill-foreground" fontSize="11" fontFamily="inherit">
        Pubky Market
      </text>
      <rect x="36" y="128" width="84" height="22" rx="11" className="fill-brand" />
      <rect x="48" y="136" width="60" height="6" rx="3" className="fill-background" />
      <Arrow d="M200 150c-30 6-60 4-72-8" />
    </Frame>
  );
}

function ConfigureScreen() {
  return (
    <Frame>
      <Field y={52} label={52} active />
      <Field y={84} label={86} active />
      <rect x="20" y="42" width="84" height="12" rx="6" className="fill-muted-foreground/30" />
      <rect x="20" y="62" width="70" height="12" rx="6" className="fill-muted-foreground/30" />
      <rect x="20" y="82" width="76" height="12" rx="6" className="fill-muted-foreground/30" />
      <rect x="20" y="102" width="60" height="12" rx="6" className="fill-muted-foreground/30" />
      <rect x="120" y="108" width="26" height="14" rx="7" className="fill-background stroke-border" strokeWidth="1.2" />
      <circle cx="127" cy="115" r="4" className="fill-muted-foreground/60" />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect
          key={index}
          x={120 + index * 36}
          y="132"
          width="32"
          height="12"
          rx="6"
          className="fill-card stroke-brand"
          strokeWidth="1.4"
        />
      ))}
      <rect x="236" y="152" width="60" height="18" rx="9" className="fill-brand" />
      <rect x="248" y="159" width="36" height="5" rx="2.5" className="fill-background" />
    </Frame>
  );
}

function KeysScreen() {
  return (
    <Frame>
      <rect x="20" y="42" width="84" height="12" rx="6" className="fill-muted-foreground/30" />
      <rect x="20" y="62" width="70" height="12" rx="6" className="fill-muted-foreground/30" />
      <Line x={120} y={46} width={52} />
      <rect x="120" y="56" width="176" height="20" rx="4" className="fill-background stroke-brand" strokeWidth="1.8" />
      <circle cx="282" cy="66" r="5" className="stroke-muted-foreground" strokeWidth="1.4" fill="none" />
      <Line x={120} y={92} width={72} />
      <rect x="120" y="102" width="176" height="20" rx="4" className="fill-background stroke-brand" strokeWidth="1.8" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => (
        <circle key={index} cx={130 + index * 9} cy="112" r="2.6" className="fill-muted-foreground/70" />
      ))}
      <circle cx="282" cy="112" r="5" className="stroke-muted-foreground" strokeWidth="1.4" fill="none" />
      <Arrow d="M110 150c24 6 54 2 66-16" />
    </Frame>
  );
}

function InstallScreen() {
  return (
    <Frame>
      <rect x="64" y="42" width="192" height="126" rx="8" className="fill-background stroke-border" strokeWidth="1.2" />
      <circle cx="90" cy="64" r="10" className="fill-brand" />
      <Line x={108} y={58} width={96} />
      <Line x={108} y={70} width={60} />
      {[0, 1, 2, 3].map((index) => (
        <g key={index}>
          <circle cx="82" cy={92 + index * 14} r="3" className="fill-brand" />
          <Line x={92} y={89 + index * 14} width={80 + (index % 2) * 30} />
        </g>
      ))}
      <rect x="170" y="144" width="76" height="18" rx="9" className="fill-brand" />
      <rect x="184" y="151" width="48" height="5" rx="2.5" className="fill-background" />
      <Arrow d="M150 168c8 6 14 2 20-6" />
    </Frame>
  );
}

function DoneScreen() {
  return (
    <Frame>
      <circle cx="68" cy="82" r="22" className="fill-brand" />
      <path d="M58 82l7 8 13-16" className="stroke-background" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Line x={108} y={58} width={110} />
      <Line x={108} y={72} width={72} />
      {[0, 1, 2].map((index) => (
        <g key={index}>
          <rect x={108 + index * 64} y="94" width="56" height="12" rx="6" className="fill-card stroke-brand" />
        </g>
      ))}
      {[0, 1, 2, 3].map((index) => (
        <g key={index}>
          <rect x={30 + index * 68} y="124" width="60" height="40" rx="6" className="fill-card stroke-border" />
          <rect x={38 + index * 68} y="130" width="44" height="18" rx="3" className="fill-muted-foreground/30" />
          <Line x={38 + index * 68} y={154} width={32} />
        </g>
      ))}
    </Frame>
  );
}

const SCREENS: Readonly<Record<ShopifyGuideScreen, () => ReactNode>> = {
  admin: AdminScreen,
  create: CreateScreen,
  configure: ConfigureScreen,
  keys: KeysScreen,
  install: InstallScreen,
  done: DoneScreen,
};

/**
 * One picture per guide step. A real screenshot replaces the drawing as soon
 * as `SHOPIFY_GUIDE_SCREENSHOTS` has an entry for the screen.
 */
export function ShopifyGuideFigure({ screen }: { screen: ShopifyGuideScreen }) {
  const screenshot = SHOPIFY_GUIDE_SCREENSHOTS[screen];
  const Drawing = SCREENS[screen];

  return (
    <figure
      className="m-0 w-full max-w-sm"
      data-testid={`guide-figure-${screen}`}
      data-kind={screenshot ? 'screenshot' : 'drawing'}
    >
      {screenshot ? (
        <BasePathImage
          src={screenshot.src}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          className="h-auto w-full rounded-md border border-border"
        />
      ) : (
        <svg viewBox="0 0 320 180" role="img" aria-label={FIGURE_LABELS[screen]} className="h-auto w-full">
          <defs>
            <marker
              id="guide-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M1 1l8 4-8 4" className="stroke-brand" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </marker>
          </defs>
          <Drawing />
        </svg>
      )}
    </figure>
  );
}
