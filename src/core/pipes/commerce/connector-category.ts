import { resolveCommerceCategory } from '@/config/taxonomy/taxonomy';

/**
 * Places a store product in the marketplace category tree (taxonomy v2).
 *
 * Deterministic and pure. The sources, in order:
 *
 * 1. the store's own classification: Shopify's Standard Product Taxonomy full
 *    name (`Apparel & Accessories > Clothing > Clothing Tops > Hoodies`), matched
 *    by the longest rule whose path is a prefix of it (`TAXONOMY_RULES`);
 * 2. keywords in the store's other classification strings (a Shopify product
 *    type, a WooCommerce category name), then in the tags, then in the title
 *    (`KEYWORD_RULES`);
 * 3. nothing matched: an empty id, which the listing records as uncategorized.
 *
 * Fashion has an audience branch (men, women, kids) that Shopify's taxonomy
 * does not carry: it is read from the same text, and an item that names none
 * (a unisex tee) goes to the men branch, the tree's adult default.
 */

export type StoreCategoryInput = {
  /** The store's own classification: Shopify taxonomy full name and product type, or WooCommerce category names. */
  readonly categories: readonly string[];
  readonly tags?: readonly string[];
  readonly title: string;
};

export type StoreCategoryMatch = {
  /** A category id of the marketplace taxonomy, or '' when nothing matched. */
  readonly categoryId: string;
  readonly source: 'taxonomy' | 'category' | 'tag' | 'title' | 'none';
};

type Audience = 'men' | 'women' | 'kids';

/** A fixed category id, or a fashion leaf under the audience branch (`tops-hoodies` is `fashion-<audience>-tops-hoodies`). */
type Target =
  | { readonly id: string }
  | { readonly fashion: string; readonly audience?: Audience; readonly fallbackAudience?: Audience };

const fixed = (id: string): Target => ({ id });
/** `audience` forces the branch; `fallbackAudience` is used when the text names none (a dress is for women unless it says otherwise). */
const fashion = (leaf: string, audience?: Audience, fallbackAudience?: Audience): Target => ({
  fashion: leaf,
  ...(audience ? { audience } : {}),
  ...(fallbackAudience ? { fallbackAudience } : {}),
});

/**
 * Shopify Standard Product Taxonomy path prefixes. A rule matches a product
 * when its segments are the first segments of the product's category; the
 * longest matching rule wins, so a specific rule beats its parent.
 */
const TAXONOMY_RULES: readonly (readonly [string, Target])[] = [
  // Apparel: tops
  ['Apparel & Accessories > Clothing > Clothing Tops', fashion('tops')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Hoodies', fashion('tops-hoodies')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts', fashion('tops-sweatshirts')],
  ['Apparel & Accessories > Clothing > Clothing Tops > T-Shirts', fashion('tops-tshirts')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Polos', fashion('tops-polo-shirts')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Shirts', fashion('tops-shirts')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Overshirts', fashion('tops-shirts')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Sweaters', fashion('tops-jumpers')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Cardigans', fashion('tops-cardigans')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Blouses', fashion('tops-blouses')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Bodysuits', fashion('tops-bodysuits')],
  ['Apparel & Accessories > Clothing > Clothing Tops > Tank Tops', fashion('tops-vests-tanks-camis')],
  [
    'Apparel & Accessories > Clothing > Activewear > Activewear Sweatshirts & Hoodies > Hoodies',
    fashion('tops-hoodies'),
  ],
  [
    'Apparel & Accessories > Clothing > Activewear > Activewear Sweatshirts & Hoodies > Sweatshirts',
    fashion('tops-sweatshirts'),
  ],
  // Apparel: everything else worn
  ['Apparel & Accessories > Clothing > Outerwear', fashion('coats-jackets')],
  ['Apparel & Accessories > Clothing > Outerwear > Coats & Jackets', fashion('coats-jackets')],
  ['Apparel & Accessories > Clothing > Outerwear > Vests', fashion('coats-jackets-gilets')],
  ['Apparel & Accessories > Clothing > Dresses', fashion('dresses', undefined, 'women')],
  ['Apparel & Accessories > Clothing > Pants', fashion('bottoms')],
  ['Apparel & Accessories > Clothing > Shorts', fashion('bottoms')],
  ['Apparel & Accessories > Clothing > Skirts', fashion('bottoms', undefined, 'women')],
  ['Apparel & Accessories > Clothing > Skorts', fashion('bottoms', undefined, 'women')],
  ['Apparel & Accessories > Clothing > One-Pieces', fashion('jumpsuit-and-playsuit')],
  ['Apparel & Accessories > Clothing > Suits', fashion('suits')],
  ['Apparel & Accessories > Clothing > Swimwear', fashion('swim-beach-wear')],
  ['Apparel & Accessories > Clothing > Sleepwear & Loungewear', fashion('nightwear')],
  ['Apparel & Accessories > Clothing > Socks', fashion('underwear')],
  ['Apparel & Accessories > Clothing > Lingerie', fashion('underwear', 'women')],
  ["Apparel & Accessories > Clothing > Men's Undergarments", fashion('underwear', 'men')],
  ['Apparel & Accessories > Clothing > Activewear', fashion('tops')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Pants', fashion('bottoms')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Tops', fashion('tops')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Tops > T-Shirts', fashion('tops-tshirts')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Tops > Tank Tops', fashion('tops-vests-tanks-camis')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Tops > Crop Tops', fashion('tops-crop-top')],
  ['Apparel & Accessories > Clothing > Activewear > Activewear Vests & Jackets', fashion('coats-jackets')],
  [
    'Apparel & Accessories > Clothing > Activewear > Activewear Vests & Jackets > Jackets',
    fashion('coats-jackets-jackets'),
  ],
  [
    'Apparel & Accessories > Clothing > Activewear > Activewear Vests & Jackets > Vests',
    fashion('coats-jackets-gilets'),
  ],
  [
    'Apparel & Accessories > Clothing > Activewear > Activewear Sweatshirts & Hoodies > Track Jackets',
    fashion('coats-jackets-jackets'),
  ],
  ['Apparel & Accessories > Costumes & Accessories', fashion('fancy-dress')],
  ["Apparel & Accessories > Clothing > Baby & Children's Clothing", fashion('tops', 'kids')],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Bottoms",
    fashion('bottoms', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Dresses",
    fashion('dresses', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's One-Pieces",
    fashion('jumpsuit-and-playsuit', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Outerwear",
    fashion('coats-jackets', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Sleepwear",
    fashion('nightwear', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Swimwear",
    fashion('swim-beach-wear', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies",
    fashion('tops-hoodies', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Sweatshirts",
    fashion('tops-sweatshirts', 'kids'),
  ],
  ['Apparel & Accessories > Shoes', fashion('footwear')],
  ["Apparel & Accessories > Shoes > Baby & Children's Shoes", fashion('footwear', 'kids')],
  // Apparel: accessories
  ['Apparel & Accessories > Clothing Accessories', fashion('accessories-other-accessories')],
  ['Apparel & Accessories > Clothing Accessories > Hats', fashion('accessories-hat')],
  ['Apparel & Accessories > Clothing Accessories > Headwear', fashion('accessories-hat')],
  [
    "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories",
    fashion('accessories', 'kids'),
  ],
  [
    "Apparel & Accessories > Clothing Accessories > Baby & Children's Clothing Accessories > Baby & Children's Hats",
    fashion('accessories-hat', 'kids'),
  ],
  ['Apparel & Accessories > Clothing Accessories > Belts', fashion('accessories-belt')],
  ['Apparel & Accessories > Clothing Accessories > Gloves & Mittens', fashion('accessories-gloves')],
  ['Apparel & Accessories > Clothing Accessories > Hair Accessories', fashion('accessories-hair-accessories')],
  ['Apparel & Accessories > Clothing Accessories > Scarves & Shawls', fashion('accessories-scarf-wraps')],
  ['Apparel & Accessories > Clothing Accessories > Bandanas & Headties', fashion('accessories-scarf-wraps')],
  ['Apparel & Accessories > Clothing Accessories > Neck Gaiters', fashion('accessories-scarf-wraps')],
  ['Apparel & Accessories > Clothing Accessories > Sunglasses', fashion('accessories-sunglasses')],
  ['Apparel & Accessories > Clothing Accessories > Fashion Face Masks', fixed('other-face-masks')],
  ['Apparel & Accessories > Handbags, Wallets & Cases', fashion('accessories-bag')],
  ['Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips', fashion('accessories-wallet-purses')],
  ['Apparel & Accessories > Handbags, Wallets & Cases > Business Card Cases', fashion('accessories-wallet-purses')],
  ['Apparel & Accessories > Handbag & Wallet Accessories', fashion('accessories-other-accessories')],
  ['Luggage & Bags', fashion('accessories-bag')],
  ['Luggage & Bags > Laptop Bags', fixed('electronics-tech-accessories-laptop-bags')],
  // Jewelry and watches
  ['Apparel & Accessories > Jewelry', fixed('jewelry-watches')],
  ['Apparel & Accessories > Jewelry > Necklaces', fixed('jewelry-watches-necklaces')],
  ['Apparel & Accessories > Jewelry > Rings', fixed('jewelry-watches-rings')],
  ['Apparel & Accessories > Jewelry > Earrings', fixed('jewelry-watches-earrings')],
  ['Apparel & Accessories > Jewelry > Bracelets', fixed('jewelry-watches-bracelets')],
  ['Apparel & Accessories > Jewelry > Brooches & Lapel Pins', fixed('jewelry-watches-brooches-pins')],
  ['Apparel & Accessories > Jewelry > Watches', fixed('jewelry-watches-watches')],
  ['Apparel & Accessories > Jewelry > Smart Watches', fixed('electronics-wearables')],
  // Electronics
  ['Electronics', fixed('electronics')],
  ['Electronics > Audio', fixed('electronics-audio')],
  ['Electronics > Computers', fixed('electronics-computers')],
  ['Electronics > Computers > Laptops', fixed('electronics-computers-laptops')],
  ['Electronics > Computers > Desktop Computers', fixed('electronics-computers-desktops')],
  ['Electronics > Communications > Telephony', fixed('electronics-phones')],
  ['Electronics > Electronics Accessories', fixed('electronics-tech-accessories')],
  [
    'Electronics > Electronics Accessories > Computer Accessories > Computer Covers & Skins > Laptop Sleeves',
    fixed('electronics-tech-accessories-laptop-bags'),
  ],
  [
    'Electronics > Communications > Telephony > Mobile & Smart Phone Accessories > Mobile Phone Cases',
    fixed('electronics-tech-accessories-phone-cases'),
  ],
  ['Electronics > Video', fixed('electronics-tvs')],
  ['Electronics > Video Game Consoles', fixed('electronics-video-games-consoles')],
  ['Electronics > Video Game Console Accessories', fixed('electronics-video-games-accessories')],
  ['Cameras & Optics', fixed('electronics-cameras-film')],
  // Home and garden
  ['Home & Garden', fixed('home')],
  ['Home & Garden > Decor', fixed('home-decor')],
  ['Home & Garden > Decor > Artwork', fixed('art-prints')],
  ['Home & Garden > Kitchen & Dining', fixed('home-kitchen')],
  ['Home & Garden > Kitchen & Dining > Tableware', fixed('home-dinnerware')],
  ['Home & Garden > Lawn & Garden', fixed('home-garden')],
  ['Home & Garden > Plants', fixed('home-garden')],
  ['Home & Garden > Household Appliances', fixed('home-appliances')],
  ['Home & Garden > Linens & Bedding', fixed('home-soft-furnishings')],
  ['Home & Garden > Household Supplies > Storage & Organization', fixed('home-storage')],
  ['Home & Garden > Parasols & Rain Umbrellas', fixed('other-umbrellas')],
  ['Furniture', fixed('home-furniture')],
  ['Arts & Entertainment > Party & Celebration', fixed('home-party-supplies')],
  ['Arts & Entertainment > Hobbies & Creative Arts > Collectibles', fixed('collectibles')],
  ['Arts & Entertainment > Hobbies & Creative Arts > Musical Instruments', fixed('music-instruments')],
  [
    'Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts > Art & Crafting Materials > Embellishments & Trims > Decorative Stickers',
    fixed('art-stickers'),
  ],
  // Media, music, books
  ['Media > Books', fixed('books-media-books')],
  ['Media > Magazines & Newspapers', fixed('books-media-magazines')],
  ['Media > Videos', fixed('books-media-movies-tv')],
  ['Media > Music & Sound Recordings', fixed('music-vinyl')],
  // Sports, beauty, toys
  ['Sporting Goods', fixed('sports')],
  ['Sporting Goods > Fitness & General Exercise Equipment', fixed('sports-fitness')],
  ['Sporting Goods > Outdoor Recreation > Cycling', fixed('sports-cycling')],
  ['Sporting Goods > Outdoor Recreation > Camping & Hiking', fixed('sports-camping-hiking')],
  ['Health & Beauty > Personal Care', fixed('beauty')],
  ['Health & Beauty > Personal Care > Cosmetics', fixed('beauty')],
  ['Health & Beauty > Personal Care > Cosmetics > Makeup', fixed('beauty-makeup')],
  ['Health & Beauty > Personal Care > Cosmetics > Nail Care', fixed('beauty-nails')],
  ['Health & Beauty > Personal Care > Cosmetics > Skin Care', fixed('beauty-skincare')],
  ['Health & Beauty > Personal Care > Cosmetics > Perfumes & Colognes', fixed('beauty-fragrance')],
  ['Health & Beauty > Personal Care > Cosmetics > Bath & Body', fixed('beauty-bath-body')],
  ['Health & Beauty > Personal Care > Hair Care', fixed('beauty-haircare')],
  ['Health & Beauty > Personal Care > Shaving & Grooming', fixed('beauty-grooming')],
  ['Toys & Games', fixed('toys-games')],
  ['Toys & Games > Puzzles', fixed('toys-games-puzzles')],
  ['Toys & Games > Games', fixed('toys-games-board-games')],
  ['Toys & Games > Toys > Dolls, Playsets & Toy Figures', fixed('toys-games-action-figures')],
  ['Toys & Games > Toys > Building Toys', fixed('toys-games-building-sets')],
];

/**
 * Keywords for a product type, a WooCommerce category, a tag or a title.
 * Ordered: the first rule whose pattern matches the text wins, so the specific
 * item comes before the general one (a hoodie before a shirt, a laptop sleeve
 * before a bag). Patterns are whole words.
 */
const KEYWORD_RULES: readonly (readonly [RegExp, Target])[] = [
  [/\blaptop (?:sleeves?|bags?|cases?)\b|\bnotebook sleeves?\b/i, fixed('electronics-tech-accessories-laptop-bags')],
  [/\bairpods\b.*\bcases?\b|\bcases?\b.*\bairpods\b/i, fixed('electronics-tech-accessories')],
  [
    /\b(?:phone|iphone|samsung|galaxy|pixel|magsafe)\b.*\bcases?\b|\bcases?\b.*\b(?:phone|iphone|samsung|galaxy|pixel)\b/i,
    fixed('electronics-tech-accessories-phone-cases'),
  ],
  [/\bhood(?:ie|ies|y|ys)\b/i, fashion('tops-hoodies')],
  [/\bsweat ?shirts?\b|\bcrew ?necks?\b/i, fashion('tops-sweatshirts')],
  [/\bt-? ?shirts?\b|\btees?\b/i, fashion('tops-tshirts')],
  [/\bpolos?\b|\bpolo shirts?\b/i, fashion('tops-polo-shirts')],
  [/\btank tops?\b|\btanks\b|\bcamis?\b|\bsinglets?\b/i, fashion('tops-vests-tanks-camis')],
  [/\bsweaters?\b|\bjumpers?\b|\bpullovers?\b|\bknitwear\b/i, fashion('tops-jumpers')],
  [/\bcardigans?\b/i, fashion('tops-cardigans')],
  [/\bblouses?\b/i, fashion('tops-blouses')],
  [/\bshirts?\b|\bjerseys?\b/i, fashion('tops-shirts')],
  [/\bvests?\b|\bgilets?\b/i, fashion('coats-jackets-gilets')],
  [/\bjackets?\b|\bwindbreakers?\b|\bbombers?\b/i, fashion('coats-jackets-jackets')],
  [/\bcoats?\b|\bparkas?\b/i, fashion('coats-jackets-coats')],
  [/\bdress(?:es)?\b/i, fashion('dresses', undefined, 'women')],
  [/\bskirts?\b|\bleggings?\b/i, fashion('bottoms', undefined, 'women')],
  [/\bjoggers?\b|\bpants\b|\btrousers\b|\bjeans\b|\bshorts\b/i, fashion('bottoms')],
  [/\bswim ?suits?\b|\bbikinis?\b|\bone-?piece swim/i, fashion('swim-beach-wear', undefined, 'women')],
  [/\bswim ?(?:wear|trunks)\b|\bboard ?shorts\b/i, fashion('swim-beach-wear')],
  [/\bsocks?\b|\bunderwear\b|\bboxers?\b|\bbriefs\b/i, fashion('underwear')],
  [
    /\bsneakers?\b|\bboots?\b|\bsandals?\b|\bslides\b|\bslippers?\b|\bshoes?\b|\bflip[- ]?flops?\b/i,
    fashion('footwear'),
  ],
  [/\bhats?\b|\bcaps?\b|\bbeanies?\b|\bsnapbacks?\b|\bvisors?\b|\bbucket hats?\b/i, fashion('accessories-hat')],
  [/\bscarf\b|\bscarves\b|\bbandanas?\b|\bneck gaiters?\b/i, fashion('accessories-scarf-wraps')],
  [/\bgloves?\b|\bmittens?\b/i, fashion('accessories-gloves')],
  [/\bbelts?\b/i, fashion('accessories-belt')],
  [/\bsunglasses\b/i, fashion('accessories-sunglasses')],
  [/\bwallets?\b|\bcard ?holders?\b|\bpurses?\b/i, fashion('accessories-wallet-purses')],
  [
    /\btote(?: bags?)?s?\b|\bsuitcases?\b|\bbackpacks?\b|\bduffel(?: bags?)?\b|\bfanny packs?\b|\bdrawstring bags?\b|\bmessenger bags?\b|\bhandbags?\b|\bbags?\b/i,
    fashion('accessories-bag'),
  ],
  [/\bnecklaces?\b|\bpendants?\b/i, fixed('jewelry-watches-necklaces')],
  [/\brings?\b/i, fixed('jewelry-watches-rings')],
  [/\bearrings?\b/i, fixed('jewelry-watches-earrings')],
  [/\bbracelets?\b/i, fixed('jewelry-watches-bracelets')],
  [/\bwatch(?:es)?\b/i, fixed('jewelry-watches-watches')],
  [
    /\bmugs?\b|\bcups?\b|\b(?:pint|lowball|wine|shot) glass(?:es)?\b|\bglassware\b|\bcoasters?\b/i,
    fixed('home-dinnerware'),
  ],
  [/\btumblers?\b|\bwater bottles?\b|\bbottles?\b/i, fixed('home-kitchen')],
  [/\bcandles?\b/i, fixed('home-decor-candles')],
  [
    /\bpillows?\b|\bcushions?\b|\bblankets?\b|\btowels?\b|\bthrows?\b|\b(?:area )?rugs?\b/i,
    fixed('home-soft-furnishings'),
  ],
  [/\bstickers?\b|\bdecals?\b/i, fixed('art-stickers')],
  [/\bposters?\b|\bart prints?\b|\bprints?\b|\bcanvas\b|\bwall art\b/i, fixed('art-prints')],
  [/\bumbrellas?\b/i, fixed('other-umbrellas')],
  [/\bface masks?\b/i, fixed('other-face-masks')],
  [/\bbooks?\b/i, fixed('books-media-books')],
];

const KIDS = /\bkids?\b|\bchildren(?:'s|s)?\b|\byouth\b|\btoddlers?\b|\binfants?\b|\bbab(?:y|ies)\b/i;
const WOMEN = /\bwom[ae]n(?:'s|s)?\b|\bladies\b|\blady\b/i;
const MEN = /\bmen(?:'s|s)?\b/i;

function normalizeSegment(segment: string): string {
  return segment.replaceAll('’', "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function segmentsOf(path: string): string[] {
  return path
    .split('>')
    .map(normalizeSegment)
    .filter((segment) => segment !== '');
}

const RULES_BY_SEGMENTS = TAXONOMY_RULES.map(([path, target]) => ({ segments: segmentsOf(path), target }));

function audienceOf(texts: readonly string[], forced?: Audience, fallback: Audience = 'men'): Audience {
  if (forced) return forced;
  const text = texts.join(' | ');
  if (KIDS.test(text)) return 'kids';
  if (MEN.test(text)) return 'men';
  if (WOMEN.test(text)) return 'women';
  return fallback;
}

/** The closest id the tree knows: an id for a branch an audience lacks (men's dresses) climbs to its parent. */
function closestKnown(id: string): string {
  let candidate = id;
  while (candidate !== '' && resolveCommerceCategory(candidate) === null) {
    const cut = candidate.lastIndexOf('-');
    candidate = cut === -1 ? '' : candidate.slice(0, cut);
  }
  return candidate;
}

function resolveTarget(target: Target, texts: readonly string[]): string {
  if ('id' in target) return closestKnown(target.id);
  return closestKnown(`fashion-${audienceOf(texts, target.audience, target.fallbackAudience)}-${target.fashion}`);
}

function taxonomyTarget(category: string): Target | null {
  const segments = segmentsOf(category);
  if (segments.length === 0) return null;
  let best: { length: number; target: Target } | null = null;
  for (const rule of RULES_BY_SEGMENTS) {
    if (rule.segments.length > segments.length) continue;
    if (!rule.segments.every((segment, index) => segment === segments[index])) continue;
    if (best === null || rule.segments.length > best.length)
      best = { length: rule.segments.length, target: rule.target };
  }
  return best?.target ?? null;
}

function keywordTarget(raw: string): Target | null {
  const text = raw.replace(/[®™©]/g, '');
  for (const [pattern, target] of KEYWORD_RULES) {
    if (pattern.test(text)) return target;
  }
  return null;
}

export function mapStoreCategory(input: StoreCategoryInput): StoreCategoryMatch {
  const tags = input.tags ?? [];
  const categories = input.categories.map((entry) => entry.trim()).filter((entry) => entry !== '');
  const texts = [...categories, ...tags, input.title];

  for (const category of categories) {
    const target = taxonomyTarget(category);
    if (target) {
      const categoryId = resolveTarget(target, texts);
      if (categoryId !== '') return { categoryId, source: 'taxonomy' };
    }
  }

  const sources: readonly (readonly [StoreCategoryMatch['source'], readonly string[]])[] = [
    ['category', categories],
    ['tag', tags],
    ['title', [input.title]],
  ];
  for (const [source, entries] of sources) {
    for (const entry of entries) {
      const target = keywordTarget(entry);
      if (!target) continue;
      const categoryId = resolveTarget(target, texts);
      if (categoryId !== '') return { categoryId, source };
    }
  }
  return { categoryId: '', source: 'none' };
}
