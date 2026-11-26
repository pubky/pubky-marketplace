export const normalizeLegacyTagLabel = (label: string) => label.toLowerCase();
export const normalizeSocialTagLabel = (label: string) => label.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
