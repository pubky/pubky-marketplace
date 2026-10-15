/**
 * WooCommerce writes its product CSV header in the admin's language, so a
 * Swiss shop exports `Typ`, `Artikelnummer` or `Regulärer Preis`. This module
 * maps those headers back to the English names the Woo preset reads.
 *
 * Source of every string below: WooCommerce's own translations, exported from
 * translate.wordpress.org ("Plugins - WooCommerce - Stable (latest release)",
 * locales de, fr, it) for the strings the exporter passes through
 * `__( …, 'woocommerce' )`: `get_default_column_names()` and the numbered
 * download, attribute and Meta columns in
 * `includes/export/class-wc-product-csv-exporter.php` of WooCommerce 11.2.1,
 * the stable release (file last changed in commit
 * 5938a201befb81662baa4913614d32758bd25027). The exact msgid/msgstr pairs, the
 * PO revision dates and file hashes are committed in
 * `src/test/fixtures/woocommerce/woocommerce-po-extract.json`, and
 * `import-woo-headers.translations.test.ts` pins every label below to its
 * English msgid from that extract.
 *
 * Two German strings are older wording that WooCommerce used when the
 * Dezentralshop file was exported; they are not in today's translation and are
 * taken from that file (`src/test/fixtures/woocommerce/SOURCE.md`).
 *
 * Matching is case-insensitive and ignores non-breaking spaces and the space
 * French puts before `?`. A header in none of the tables is reported as an
 * unmapped column, never guessed.
 */

export type WooLanguage = 'en' | 'de' | 'fr' | 'it';

export const WOO_LANGUAGES: readonly WooLanguage[] = ['en', 'de', 'fr', 'it'];

type HeaderDefinition = {
  /** The English header the Woo preset reads; `%d` and `%s` stand for a number or unit. */
  readonly canonical: string;
  readonly de: readonly string[];
  readonly fr: readonly string[];
  readonly it: readonly string[];
};

export /** The mapped labels per language; exported for the translation proof in the tests. */
const HEADER_DEFINITIONS: readonly HeaderDefinition[] = [
  { canonical: 'ID', de: ['ID'], fr: ['ID'], it: ['ID'] },
  { canonical: 'Type', de: ['Typ'], fr: ['Type'], it: ['Tipo'] },
  { canonical: 'SKU', de: ['Artikelnummer'], fr: ['UGS'], it: ['SKU'] },
  {
    canonical: 'GTIN, UPC, EAN, or ISBN',
    de: ['GTIN, UPC, EAN oder ISBN'],
    fr: ['GTIN, UPC, EAN ou ISBN'],
    it: ['GTIN, UPC, EAN, o ISBN'],
  },
  { canonical: 'Name', de: ['Name'], fr: ['Nom'], it: ['Nome'] },
  { canonical: 'Published', de: ['Veröffentlicht'], fr: ['Publié'], it: ['Pubblicato'] },
  { canonical: 'Is featured?', de: ['Ist hervorgehoben?'], fr: ['Mis en avant ?'], it: ['In primo piano?'] },
  {
    canonical: 'Visibility in catalog',
    de: ['Sichtbarkeit im Katalog'],
    fr: ['Visibilité dans le catalogue'],
    it: ['Visibilità nel catalogo'],
  },
  {
    canonical: 'Short description',
    de: ['Kurzbeschreibung'],
    fr: ['Description courte'],
    it: ['Breve descrizione'],
  },
  { canonical: 'Description', de: ['Beschreibung'], fr: ['Description'], it: ['Descrizione'] },
  {
    canonical: 'Date sale price starts',
    de: ['Datum, an dem der Angebotspreis beginnt'],
    fr: ['Date de début de promo'],
    it: ['Data di partenza del prezzo in saldo'],
  },
  {
    canonical: 'Date sale price ends',
    de: ['Datum, an dem der Angebotspreis endet'],
    fr: ['Date de fin de promo'],
    it: ["Data in cui termina l'offerta"],
  },
  { canonical: 'Tax status', de: ['Steuerstatus'], fr: ['État de la TVA'], it: ['Stato delle imposte'] },
  { canonical: 'Tax class', de: ['Steuerklasse'], fr: ['Classe de TVA'], it: ['Aliquota di imposta'] },
  { canonical: 'In stock?', de: ['Vorrätig?'], fr: ['En stock ?'], it: ['In stock?'] },
  { canonical: 'Stock', de: ['Bestand'], fr: ['Stock'], it: ['Magazzino'] },
  {
    canonical: 'Low stock amount',
    de: ['Menge für geringen Bestand', 'Geringe Lagermenge'],
    fr: ['Montant de stock faible'],
    it: ['Quantità in magazzino bassa'],
  },
  {
    canonical: 'Backorders allowed?',
    de: ['Lieferrückstände erlaubt?', 'Rückstände erlaubt?'],
    fr: ['Autoriser les commandes de produits en rupture ?'],
    it: ['Abilita gli ordini arretrati?'],
  },
  {
    canonical: 'Sold individually?',
    de: ['Nur einzeln verkaufen?'],
    fr: ['Vendre individuellement ?'],
    it: ['Venduto singolarmente?'],
  },
  { canonical: 'Weight (%s)', de: ['Gewicht (%s)'], fr: ['Poids (%s)'], it: ['Peso (%s)'] },
  { canonical: 'Length (%s)', de: ['Länge (%s)'], fr: ['Longueur (%s)'], it: ['Lunghezza (%s)'] },
  { canonical: 'Width (%s)', de: ['Breite (%s)'], fr: ['Largeur (%s)'], it: ['Larghezza (%s)'] },
  { canonical: 'Height (%s)', de: ['Höhe (%s)'], fr: ['Hauteur (%s)'], it: ['Altezza (%s)'] },
  {
    canonical: 'Allow customer reviews?',
    de: ['Kundenrezensionen erlauben?'],
    fr: ['Autoriser les avis clients ?'],
    it: ['Permetti le recensioni clienti?'],
  },
  { canonical: 'Purchase note', de: ['Hinweis zum Kauf'], fr: ['Note de commande'], it: ['Nota di acquisto'] },
  { canonical: 'Sale price', de: ['Angebotspreis'], fr: ['Tarif promo'], it: ['Prezzo in offerta'] },
  { canonical: 'Regular price', de: ['Regulärer Preis'], fr: ['Tarif régulier'], it: ['Prezzo di listino'] },
  { canonical: 'Categories', de: ['Kategorien'], fr: ['Catégories'], it: ['Categorie'] },
  { canonical: 'Tags', de: ['Schlagwörter'], fr: ['Étiquettes'], it: ['Tag'] },
  { canonical: 'Shipping class', de: ['Versandklasse'], fr: ['Classe d’expédition'], it: ['Classe di spedizione'] },
  { canonical: 'Images', de: ['Bilder'], fr: ['Images'], it: ['Immagine'] },
  { canonical: 'Download limit', de: ['Downloadlimit'], fr: ['Limite de téléchargement'], it: ['Limite di download'] },
  {
    canonical: 'Download expiry days',
    de: ['Ablauftage des Downloads'],
    fr: ['Jours d’expiration du téléchargement'],
    it: ['Scarica i giorni di scadenza'],
  },
  { canonical: 'Parent', de: ['Übergeordnetes Produkt'], fr: ['Parent'], it: ['Genitore'] },
  {
    canonical: 'Grouped products',
    de: ['Gruppierte Produkte'],
    fr: ['Groupes de produits'],
    it: ['Prodotti raggruppati'],
  },
  { canonical: 'Upsells', de: ['Zusatzverkäufe'], fr: ['Produits suggérés'], it: ['Up-sell'] },
  {
    canonical: 'Cross-sells',
    de: ['Cross-Sells (Querverkäufe)'],
    fr: ['Ventes croisées'],
    it: ['Cross-sell'],
  },
  { canonical: 'External URL', de: ['Externe URL'], fr: ['URL externe'], it: ['URL esterno'] },
  { canonical: 'Button text', de: ['Button-Text'], fr: ['Libellé du bouton'], it: ['Testo del pulsante'] },
  { canonical: 'Position', de: ['Position'], fr: ['Position'], it: ['Posizione'] },
  {
    canonical: 'Cost of goods',
    de: ['Wareneinsatz'],
    fr: ['Coût des marchandises vendues'],
    it: ['Costo dei beni'],
  },
  {
    canonical: 'Download %d ID',
    de: ['Download-%d-ID'],
    fr: ['ID de téléchargement %d'],
    it: ['Scarica ID %d'],
  },
  {
    canonical: 'Download %d name',
    de: ['Download-%d-Name'],
    fr: ['Nom de téléchargement %d'],
    it: ['Nome %d download'],
  },
  {
    canonical: 'Download %d URL',
    de: ['Download-%d-URL'],
    fr: ['URL de téléchargement %d'],
    it: ['Download %d URL'],
  },
  {
    canonical: 'Attribute %d name',
    de: ['Attribut %d Name'],
    fr: ['Nom de l’attribut %d'],
    it: ["Nome dell'attributo %d"],
  },
  {
    canonical: 'Attribute %d value(s)',
    de: ['Attribut %d Wert(e)'],
    fr: ['Valeur(s) de l’attribut %d'],
    it: ["Valore dell'attributo %d"],
  },
  {
    canonical: 'Attribute %d visible',
    de: ['Attribut %d sichtbar'],
    fr: ['Attribut %d visible'],
    it: ['Attributo %d visibile'],
  },
  {
    canonical: 'Attribute %d global',
    de: ['Attribut %d global'],
    fr: ['Attribut %d global'],
    it: ['Attributo %d globale'],
  },
  {
    canonical: 'Attribute %d default',
    de: ['Attribut %d Standard'],
    fr: ['Attribut %d par défaut'],
    it: ['Attributo %d predefinito'],
  },
  { canonical: 'Meta: %s', de: ['Meta: %s'], fr: ['Méta : %s'], it: ['Meta: %s'] },
];

export function normalizeWooHeader(value: string): string {
  return value
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/ ([?:])/g, '$1')
    .trim()
    .toLowerCase();
}

type Matcher = { readonly regex: RegExp; readonly canonical: string };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcherFor(label: string, canonical: string): Matcher {
  const source = escapeRegex(normalizeWooHeader(label)).replace('%d', '(\\d+)').replace('%s', '(.+)');
  return { regex: new RegExp(`^${source}$`), canonical };
}

function matchersFor(language: WooLanguage): readonly Matcher[] {
  return HEADER_DEFINITIONS.flatMap((definition) =>
    language === 'en'
      ? [matcherFor(definition.canonical, definition.canonical)]
      : definition[language].map((label) => matcherFor(label, definition.canonical)),
  );
}

const MATCHERS: Readonly<Record<WooLanguage, readonly Matcher[]>> = {
  en: matchersFor('en'),
  de: matchersFor('de'),
  fr: matchersFor('fr'),
  it: matchersFor('it'),
};

function canonicalFor(language: WooLanguage, header: string): string | null {
  const key = normalizeWooHeader(header);
  for (const matcher of MATCHERS[language]) {
    const match = matcher.regex.exec(key);
    if (!match) continue;
    let index = 1;
    return matcher.canonical.replace(/%[ds]/g, () => match[index++] ?? '');
  }
  return null;
}

export type LocalizedWooHeaders = {
  readonly language: WooLanguage;
  /** Same length and order as the input; English where recognised, the original text where not. */
  readonly headers: readonly string[];
  /** Original headers that no table recognised. */
  readonly unrecognized: readonly string[];
};

const REQUIRED = ['type', 'sku', 'regular price'];

/**
 * The language whose table recognises the most headers, provided it yields the
 * Type, SKU and Regular price columns; `null` when the file is not a Woo
 * product export in a known language. Headers the winning language does not
 * know are tried in English, since plugin columns and some shops mix them.
 */
export function localizeWooHeaders(headers: readonly string[]): LocalizedWooHeaders | null {
  let best: { language: WooLanguage; hits: number } | null = null;
  for (const language of WOO_LANGUAGES) {
    const hits = headers.filter((header) => canonicalFor(language, header) !== null).length;
    if (hits > 0 && (best === null || hits > best.hits)) best = { language, hits };
  }
  if (!best) return null;
  const unrecognized: string[] = [];
  const localized = headers.map((header) => {
    const found = canonicalFor(best.language, header) ?? canonicalFor('en', header);
    if (found === null) unrecognized.push(header);
    return found ?? header;
  });
  const keys = new Set(localized.map((header) => header.trim().toLowerCase()));
  if (!REQUIRED.every((name) => keys.has(name))) return null;
  return { language: best.language, headers: localized, unrecognized };
}

/**
 * A header row that looks like a WooCommerce export (starts with `ID`, has the
 * exporter's many columns) but whose language no table covers. The importer
 * refuses it with a clear message instead of guessing column positions.
 */
export function looksLikeUnknownLanguageWooExport(headers: readonly string[]): boolean {
  if (headers.length < 20) return false;
  if (normalizeWooHeader(headers[0] ?? '') !== 'id') return false;
  return localizeWooHeaders(headers) === null;
}

export const WOO_UNKNOWN_LANGUAGE_MESSAGE =
  'This looks like a WooCommerce export in a language the importer does not know yet. It reads English, German, French and Italian headers. Export again with the admin language set to one of them. Nothing was published.';
