export const SHOPIFY_GUIDE_SCREENS = ['admin', 'create', 'configure', 'keys', 'install', 'done'] as const;
export type ShopifyGuideScreen = (typeof SHOPIFY_GUIDE_SCREENS)[number];

export type ShopifyGuideScreenshot = {
  /** Root-relative path under `public/`, for example `/images/shopify-guide/configure.webp`. */
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
};

/**
 * Real screenshots of the Dev Dashboard, one per screen. Each step shows its
 * screenshot when it has an entry here and its drawn illustration until then.
 * The captures come from the first run on John Staging.
 */
export const SHOPIFY_GUIDE_SCREENSHOTS: Readonly<Partial<Record<ShopifyGuideScreen, ShopifyGuideScreenshot>>> = {};
