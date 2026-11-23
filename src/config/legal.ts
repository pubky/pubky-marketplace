/** The contracting entity that provides the Shop (decision LG3). Every place that names it imports this constant. */
export const LEGAL_ENTITY_NAME = 'Synonym Software, S.A. de C.V.';

/** Where consumers and authorities send complaints, as stated in the Terms of Service. */
export const COMPLAINT_EMAIL = 'report@synonym.to';

/**
 * Synonym's homeservers by pubky, each with the host its Pkarr record names. Synonym hosts the records of
 * a seller whose homeserver is one of these, so its notice procedure (the complaint email) covers them.
 */
export const SYNONYM_HOMESERVERS: ReadonlyMap<string, string> = new Map([
  ['8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty', 'homeserver.pubky.app'],
  ['ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy', 'homeserver.staging.pubky.app'],
]);
