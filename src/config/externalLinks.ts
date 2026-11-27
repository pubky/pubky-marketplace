import {
  getGithubUrl,
  getNexusScoutUrl,
  getTelegramUrl,
  getTwitterGetpubkyUrl,
  getTwitterUrl,
} from '@/libs/runtime-config/runtime-config';

// Public, read-only Cypher gateway to the Pubky social graph — surfaced to AI agents via
// StructuredData in the root layout so they know where to query it.
export const getNexusScoutLink = getNexusScoutUrl;

// Social media links
export const getTwitterLink = getTwitterUrl;
export const getTwitterGetpubkyLink = getTwitterGetpubkyUrl;
export const getTelegramLink = getTelegramUrl;
export const getGithubLink = getGithubUrl;
