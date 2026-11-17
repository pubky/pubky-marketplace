import { describe, expect, it } from 'vitest';
import { resolveCommerceCategory } from '@/config/taxonomy/taxonomy';
import { mapStoreCategory } from './connector-category';

const category = (title: string, categories: string[] = [], tags: string[] = []) =>
  mapStoreCategory({ title, categories, tags }).categoryId;

describe('mapStoreCategory from the store taxonomy', () => {
  it.each([
    ['Apparel & Accessories > Clothing > Clothing Tops > Hoodies', 'fashion-men-tops-hoodies'],
    ['Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts', 'fashion-men-tops-sweatshirts'],
    ['Apparel & Accessories > Clothing > Clothing Tops > T-Shirts', 'fashion-men-tops-tshirts'],
    ['Apparel & Accessories > Clothing > Clothing Tops > Polos', 'fashion-men-tops-polo-shirts'],
    ['Apparel & Accessories > Clothing > Clothing Tops > Tank Tops', 'fashion-men-tops-vests-tanks-camis'],
    ['Apparel & Accessories > Clothing > Clothing Tops', 'fashion-men-tops'],
    ['Apparel & Accessories > Clothing > Outerwear > Coats & Jackets', 'fashion-men-coats-jackets'],
    ['Apparel & Accessories > Clothing > Outerwear > Vests', 'fashion-men-coats-jackets-gilets'],
    ['Apparel & Accessories > Clothing > Pants', 'fashion-men-bottoms'],
    ['Apparel & Accessories > Clothing > Swimwear', 'fashion-men-swim-beach-wear'],
    ['Apparel & Accessories > Clothing Accessories > Hats > Baseball Caps', 'fashion-men-accessories-hat'],
    ['Apparel & Accessories > Clothing Accessories > Headwear', 'fashion-men-accessories-hat'],
    ['Apparel & Accessories > Clothing Accessories > Scarves & Shawls', 'fashion-men-accessories-scarf-wraps'],
    ['Apparel & Accessories > Clothing Accessories > Fashion Face Masks', 'other-face-masks'],
    ['Apparel & Accessories > Handbags, Wallets & Cases > Handbags', 'fashion-men-accessories-bag'],
    [
      'Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips',
      'fashion-men-accessories-wallet-purses',
    ],
    ['Apparel & Accessories > Shoes > Sneakers', 'fashion-men-footwear'],
    ['Apparel & Accessories > Jewelry > Necklaces', 'jewelry-watches-necklaces'],
    ['Apparel & Accessories > Jewelry > Anklets', 'jewelry-watches'],
    ['Apparel & Accessories > Jewelry > Smart Watches', 'electronics-wearables'],
    ['Luggage & Bags > Tote Bags', 'fashion-men-accessories-bag'],
    ['Luggage & Bags > Backpacks', 'fashion-men-accessories-bag'],
    ['Luggage & Bags > Suitcases', 'fashion-men-accessories-bag'],
    ['Luggage & Bags > Laptop Bags', 'electronics-tech-accessories-laptop-bags'],
    [
      'Electronics > Electronics Accessories > Computer Accessories > Computer Covers & Skins > Laptop Sleeves',
      'electronics-tech-accessories-laptop-bags',
    ],
    [
      'Electronics > Communications > Telephony > Mobile & Smart Phone Accessories > Mobile Phone Cases',
      'electronics-tech-accessories-phone-cases',
    ],
    ['Apparel & Accessories > Clothing > Activewear > Activewear Pants > Joggers', 'fashion-men-bottoms'],
    ['Apparel & Accessories > Clothing > Activewear > Activewear Tops > T-Shirts', 'fashion-men-tops-tshirts'],
    [
      'Apparel & Accessories > Clothing > Activewear > Activewear Vests & Jackets > Jackets',
      'fashion-men-coats-jackets-jackets',
    ],
    [
      'Apparel & Accessories > Clothing > Activewear > Activewear Sweatshirts & Hoodies > Track Jackets',
      'fashion-men-coats-jackets-jackets',
    ],
    ['Health & Beauty > Personal Care > Cosmetics > Skin Care > Face Moisturizers', 'beauty-skincare'],
    ['Health & Beauty > Personal Care > Cosmetics > Makeup > Lip Makeup', 'beauty-makeup'],
    ['Health & Beauty > Personal Care > Cosmetics > Perfumes & Colognes', 'beauty-fragrance'],
    ['Health & Beauty > Personal Care > Hair Care > Shampoo & Conditioner', 'beauty-haircare'],
    ['Electronics > Computers > Laptops', 'electronics-computers-laptops'],
    ['Electronics > Audio > Audio Components', 'electronics-audio'],
    ['Electronics > Networking', 'electronics'],
    ['Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs', 'home-dinnerware'],
    ['Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork', 'art-prints'],
    ['Home & Garden > Decor > Home Fragrances', 'home-decor'],
    ['Home & Garden > Linens & Bedding > Bedding', 'home-soft-furnishings'],
    ['Furniture > Chairs', 'home-furniture'],
    ['Sporting Goods > Outdoor Recreation > Cycling', 'sports-cycling'],
    ['Toys & Games > Puzzles', 'toys-games-puzzles'],
    ['Media > Books', 'books-media-books'],
    ['Cameras & Optics > Cameras', 'electronics-cameras-film'],
    [
      'Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts > Art & Crafting Materials > Embellishments & Trims > Decorative Stickers',
      'art-stickers',
    ],
  ])('maps %s to %s', (storeCategory, expected) => {
    expect(category('A thing', [storeCategory])).toBe(expected);
  });

  it('lets the longest matching path win over its parent', () => {
    expect(category('x', ['Apparel & Accessories > Clothing > Clothing Tops > Hoodies > Zip Hoodies'])).toBe(
      'fashion-men-tops-hoodies',
    );
    expect(category('x', ['Apparel & Accessories > Clothing > Clothing Tops > Tunics'])).toBe('fashion-men-tops');
  });

  it('ignores case, spacing and curly apostrophes in the store path', () => {
    expect(category('x', ['apparel &  accessories > clothing > clothing tops > hoodies'])).toBe(
      'fashion-men-tops-hoodies',
    );
    expect(category('x', ['Apparel & Accessories > Clothing > Baby & Children’s Clothing'])).toBe('fashion-kids-tops');
  });

  it('puts children’s clothing in the kids branch and climbs where a branch lacks the leaf', () => {
    expect(
      category('x', [
        "Apparel & Accessories > Clothing > Baby & Children's Clothing > Baby & Children's Tops > Hoodies",
      ]),
    ).toBe('fashion-kids-tops-hoodies');
    expect(category('Summer dress', ['Apparel & Accessories > Clothing > Dresses'])).toBe('fashion-women-dresses');
    expect(category("Men's summer dress", ['Apparel & Accessories > Clothing > Dresses'])).toBe('fashion-men');
    expect(category("Women's summer dress", ['Apparel & Accessories > Clothing > Dresses'])).toBe(
      'fashion-women-dresses',
    );
  });
});

describe('mapStoreCategory audience', () => {
  const hoodie = ['Apparel & Accessories > Clothing > Clothing Tops > Hoodies'];

  it('reads women, kids and men from the title, the types and the tags', () => {
    expect(category("Women's Fitted Hoodie", hoodie)).toBe('fashion-women-tops-hoodies');
    expect(category('Hoodie', hoodie, ['Womens clothing'])).toBe('fashion-women-tops-hoodies');
    expect(category('Kids Hoodie', hoodie)).toBe('fashion-kids-tops-hoodies');
    expect(category('Youth Hoodie', hoodie)).toBe('fashion-kids-tops-hoodies');
    expect(category("Men's Hoodie", hoodie)).toBe('fashion-men-tops-hoodies');
  });

  it('puts a unisex or unnamed item, and one for men and women, in the men branch', () => {
    expect(category('Unisex Hoodie', hoodie)).toBe('fashion-men-tops-hoodies');
    expect(category('Hoodie', hoodie)).toBe('fashion-men-tops-hoodies');
    expect(category("Men's and Women's Hoodie", hoodie)).toBe('fashion-men-tops-hoodies');
  });

  it('lets a stated audience beat the item default, and an item default beat the men default', () => {
    expect(category("Men's swimsuit")).toBe('fashion-men-swim-beach-wear');
    expect(category('Kids dress')).toBe('fashion-kids-dresses');
    expect(category("Women's Joggers")).toBe('fashion-women-bottoms');
    expect(category('Dress')).toBe('fashion-women-dresses');
  });

  it('uses the women default for a swimsuit, leggings or a dress on the Shopify taxonomy path too', () => {
    expect(category('Swimsuit', ['Apparel & Accessories > Clothing > Swimwear'])).toBe('fashion-women-swim-beach-wear');
    expect(category('Trunks', ['Apparel & Accessories > Clothing > Swimwear > Swim Shorts'])).toBe(
      'fashion-men-swim-beach-wear',
    );
    expect(category('Yoga Leggings', ['Apparel & Accessories > Clothing > Activewear > Activewear Pants'])).toBe(
      'fashion-women-bottoms',
    );
    expect(category('Floral', ['Apparel & Accessories > Clothing > Swimwear > Classic Bikinis'])).toBe(
      'fashion-women-swim-beach-wear',
    );
    expect(category('Plain', ['Apparel & Accessories > Clothing > Pants > Leggings'])).toBe('fashion-women-bottoms');
    expect(category("Men's Swimsuit", ['Apparel & Accessories > Clothing > Swimwear'])).toBe(
      'fashion-men-swim-beach-wear',
    );
  });

  it('does not take a dress shirt, dress shoes or a dress code for a dress', () => {
    expect(category('Dress Shirt')).toBe('fashion-men-tops-shirts');
    expect(category('Dress Shoes')).toBe('fashion-men-footwear');
    expect(category('Oxford', ['Apparel & Accessories > Clothing > Clothing Tops > Shirts > Dress Shirts'])).toBe(
      'fashion-men-tops-shirts',
    );
  });

  it('files a jersey dress as a dress, and keeps presentation slides and case studies out of footwear and phone cases', () => {
    expect(category('Jersey dress')).toBe('fashion-women-dresses');
    expect(category('Presentation slides')).toBe('');
    expect(category('Phone Booth Case Study')).toBe('');
    expect(category('Case for iPhone 15')).toBe('electronics-tech-accessories-phone-cases');
    expect(category('Magsafe Clear Case')).toBe('electronics-tech-accessories-phone-cases');
  });

  it('does not read "men" inside "women"', () => {
    expect(category('Women Tee')).toBe('fashion-women-tops-tshirts');
  });
});

describe('mapStoreCategory keyword fallback', () => {
  it.each([
    ['Hoodie', 'fashion-men-tops-hoodies'],
    ['Zip hoody', 'fashion-men-tops-hoodies'],
    ['Crewneck sweatshirt', 'fashion-men-tops-sweatshirts'],
    ['T-Shirt', 'fashion-men-tops-tshirts'],
    ['Unisex Tee', 'fashion-men-tops-tshirts'],
    ['Polo shirt', 'fashion-men-tops-polo-shirts'],
    ['Knit sweater', 'fashion-men-tops-jumpers'],
    ['Oxford shirt', 'fashion-men-tops-shirts'],
    ['Sports Jersey', 'fashion-men-tops-shirts'],
    ['Bomber jacket', 'fashion-men-coats-jackets-jackets'],
    ['Trucker cap', 'fashion-men-accessories-hat'],
    ['Dad Hat', 'fashion-men-accessories-hat'],
    ['Beanie', 'fashion-men-accessories-hat'],
    ['Tote bag', 'fashion-men-accessories-bag'],
    ['Backpack', 'fashion-men-accessories-bag'],
    ['Laptop Sleeve', 'electronics-tech-accessories-laptop-bags'],
    ['iPhone case', 'electronics-tech-accessories-phone-cases'],
    ['Ceramic mug', 'home-dinnerware'],
    ['Steel tumbler', 'home-kitchen'],
    ['Kiss-cut sticker', 'art-stickers'],
    ['Poster', 'art-prints'],
    ['Throw pillow', 'home-soft-furnishings'],
    ['Soy candle', 'home-decor-candles'],
    ['Leggings', 'fashion-women-bottoms'],
    ['Joggers', 'fashion-men-bottoms'],
    ['Swimsuit', 'fashion-women-swim-beach-wear'],
    ['String bikini', 'fashion-women-swim-beach-wear'],
    ['Swim trunks', 'fashion-men-swim-beach-wear'],
    ['Floral dress', 'fashion-women-dresses'],
    ['Lace-up canvas shoes', 'fashion-men-footwear'],
    ['Slides', 'fashion-men-footwear'],
    ['Neck gaiter', 'fashion-men-accessories-scarf-wraps'],
    ['Duffle bag', 'fashion-men-accessories-bag'],
    ['Suitcase', 'fashion-men-accessories-bag'],
    ['MagSafe® iPhone® Case', 'electronics-tech-accessories-phone-cases'],
    ['Case for Samsung®', 'electronics-tech-accessories-phone-cases'],
    ['Case for AirPods®', 'electronics-tech-accessories'],
    ['Pint Glass', 'home-dinnerware'],
    ['Coaster', 'home-dinnerware'],
    ['Area Rug', 'home-soft-furnishings'],
    ['Crew socks', 'fashion-men-underwear'],
  ])('reads the product type "%s" as %s', (productType, expected) => {
    expect(category('Something', [productType])).toBe(expected);
  });

  it('prefers the product type over the tags and the tags over the title', () => {
    expect(category('Logo Hoodie', ['Mug'])).toBe('home-dinnerware');
    expect(category('Logo Hoodie', [], ['Tote bag'])).toBe('fashion-men-accessories-bag');
    expect(category('Logo Hoodie')).toBe('fashion-men-tops-hoodies');
  });

  it('puts a specific item before a general one in the same text', () => {
    expect(category('Laptop sleeve bag')).toBe('electronics-tech-accessories-laptop-bags');
    expect(category('Hoodie shirt')).toBe('fashion-men-tops-hoodies');
    expect(category('Sweatshirt')).toBe('fashion-men-tops-sweatshirts');
  });

  it('matches whole words only', () => {
    expect(category('Capital gains planner')).toBe('');
    expect(category('Ringo', [])).toBe('');
    expect(category('Teepee')).toBe('');
  });

  it('uses a WooCommerce category name', () => {
    expect(category('Dezentral', ['T-shirts'])).toBe('fashion-men-tops-tshirts');
    expect(category('Dezentral', ['Clothing &amp; Gear'])).toBe('');
  });

  it('leaves what nothing matches uncategorized', () => {
    expect(category('Satoshi plush', ['Misc'])).toBe('');
    expect(category('Thing', [])).toBe('');
    expect(category('Thing', ['Vehicles & Parts > Motor Vehicle Parts'])).toBe('');
  });

  it('is deterministic', () => {
    const input = { title: "Women's Bitcoin Hoodie", categories: ['Hoodie'], tags: ['x'] };
    expect(mapStoreCategory(input)).toEqual(mapStoreCategory(input));
  });

  it('says which source decided', () => {
    expect(mapStoreCategory({ title: 't', categories: ['Apparel & Accessories > Clothing > Pants'] }).source).toBe(
      'taxonomy',
    );
    expect(mapStoreCategory({ title: 't', categories: ['Hoodie'] }).source).toBe('category');
    expect(mapStoreCategory({ title: 't', categories: [], tags: ['Hoodie'] }).source).toBe('tag');
    expect(mapStoreCategory({ title: 'Hoodie', categories: [] }).source).toBe('title');
    expect(mapStoreCategory({ title: 'Plush', categories: [] }).source).toBe('none');
  });
});

describe('mapStoreCategory only yields ids of the marketplace taxonomy', () => {
  const stores = [
    'Apparel & Accessories > Clothing > Clothing Tops > Hoodies',
    'Apparel & Accessories > Clothing > Dresses',
    'Apparel & Accessories > Clothing > Socks',
    'Apparel & Accessories > Clothing > Lingerie',
    "Apparel & Accessories > Clothing > Men's Undergarments",
    'Apparel & Accessories > Clothing > Swimwear',
    'Apparel & Accessories > Clothing > One-Pieces',
    'Apparel & Accessories > Clothing > Suits',
    'Apparel & Accessories > Costumes & Accessories',
    'Apparel & Accessories > Shoes > Boots',
    'Apparel & Accessories > Clothing Accessories > Hats',
    'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
    'Luggage & Bags > Duffel Bags',
  ];

  it.each(['Women', 'Kids', 'Men', ''])('resolves every table result for the audience "%s"', (audience) => {
    for (const storeCategory of stores) {
      const { categoryId } = mapStoreCategory({ title: `${audience} item`, categories: [storeCategory] });
      expect(categoryId, storeCategory).not.toBe('');
      expect(resolveCommerceCategory(categoryId), `${storeCategory} -> ${categoryId}`).not.toBeNull();
    }
  });

  it('resolves every keyword result', () => {
    const words = [
      'hoodie',
      'sweatshirt',
      't-shirt',
      'polo',
      'tank top',
      'sweater',
      'cardigan',
      'blouse',
      'shirt',
      'vest',
      'jacket',
      'coat',
      'dress',
      'leggings',
      'swimsuit',
      'socks',
      'sneakers',
      'hat',
      'scarf',
      'gloves',
      'belt',
      'sunglasses',
      'wallet',
      'tote',
      'necklace',
      'ring',
      'earrings',
      'bracelet',
      'watch',
      'mug',
      'bottle',
      'candle',
      'pillow',
      'sticker',
      'poster',
      'umbrella',
      'face mask',
      'book',
      'laptop sleeve',
      'phone case',
    ];
    for (const audience of ['', "Women's ", 'Kids ']) {
      for (const word of words) {
        const { categoryId } = mapStoreCategory({ title: `${audience}${word}`, categories: [] });
        expect(categoryId, word).not.toBe('');
        expect(resolveCommerceCategory(categoryId), `${audience}${word} -> ${categoryId}`).not.toBeNull();
      }
    }
  });
});

describe('a Printful catalog as a Shopify store lists it', () => {
  const cases: [string, string[], string][] = [
    [
      'Bitcoin Standard Unisex Hoodie',
      ['Apparel & Accessories > Clothing > Clothing Tops > Hoodies', 'Hoodie'],
      'fashion-men-tops-hoodies',
    ],
    [
      'Hodl Unisex T-Shirt',
      ['Apparel & Accessories > Clothing > Clothing Tops > T-Shirts', 'T-Shirt'],
      'fashion-men-tops-tshirts',
    ],
    ['Sats Dad Hat', ['Apparel & Accessories > Clothing Accessories > Hats', 'Hat'], 'fashion-men-accessories-hat'],
    ['Orange Pill Tote Bag', ['Luggage & Bags > Tote Bags', 'Tote bag'], 'fashion-men-accessories-bag'],
    [
      'Not Your Keys Laptop Sleeve',
      ['Electronics > Electronics Accessories > Computer Accessories > Computer Covers & Skins > Laptop Sleeves'],
      'electronics-tech-accessories-laptop-bags',
    ],
    ['Bitcoin Unisex Hoodie', ['Hoodie'], 'fashion-men-tops-hoodies'],
    ['Hodl Tee', [], 'fashion-men-tops-tshirts'],
    ['Sats Embroidered Hat', [], 'fashion-men-accessories-hat'],
    ['Orange Pill All-Over Print Tote', [], 'fashion-men-accessories-bag'],
    ['Neon Floral Swimsuit', [], 'fashion-women-swim-beach-wear'],
    ["Waves Women's Slides", [], 'fashion-women-footwear'],
    ['Floral iPhone® Case', [], 'electronics-tech-accessories-phone-cases'],
    ['Magma Suitcase', [], 'fashion-men-accessories-bag'],
    ['Orange Coin Mug', [], 'home-dinnerware'],
    ['Spiral Notebook', [], ''],
    ['Not Your Keys Laptop Sleeve', [], 'electronics-tech-accessories-laptop-bags'],
  ];

  it.each(cases)('files "%s" (%j) under %s', (title, categories, expected) => {
    expect(category(title, categories)).toBe(expected);
  });
});
