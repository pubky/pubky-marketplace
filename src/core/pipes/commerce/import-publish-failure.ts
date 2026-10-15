/**
 * Classifies why one listing could not be mapped to a publishable record, so
 * a failed listing is reported with a reason and the rest of the import
 * carries on.
 */

export type ListingPublishFailure = {
  /** Short code stored on the manifest rows and shown in the result CSV. */
  readonly code: 'photo_required' | 'invalid_listing';
  readonly message: string;
};

export const PHOTO_REQUIRED_MESSAGE = 'A listing needs at least one photo before it can be published.';

export function classifyListingPublishFailure(message: string): ListingPublishFailure {
  if (message === PHOTO_REQUIRED_MESSAGE) return { code: 'photo_required', message };
  return { code: 'invalid_listing', message };
}

export function invalidListingsCopy(failures: readonly ListingPublishFailure[]): string {
  if (failures.length > 0 && failures.every((failure) => failure.code === 'photo_required')) {
    return `${failures.length} listing${failures.length === 1 ? ' needs' : 's need'} a photo before ${failures.length === 1 ? 'it' : 'they'} can be published. Download the result to see which.`;
  }
  return `${failures.length} listing${failures.length === 1 ? ' was' : 's were'} not published. Download the result to see why.`;
}
