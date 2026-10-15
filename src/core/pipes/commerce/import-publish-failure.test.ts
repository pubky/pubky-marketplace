import { describe, expect, it } from 'vitest';
import { classifyListingPublishFailure, invalidListingsCopy, PHOTO_REQUIRED_MESSAGE } from './import-publish-failure';

describe('classifyListingPublishFailure', () => {
  it('recognises the missing-photo refusal and keeps any other reason verbatim', () => {
    expect(classifyListingPublishFailure(PHOTO_REQUIRED_MESSAGE)).toEqual({
      code: 'photo_required',
      message: PHOTO_REQUIRED_MESSAGE,
    });
    expect(classifyListingPublishFailure('Title too short')).toEqual({
      code: 'invalid_listing',
      message: 'Title too short',
    });
  });
});

describe('invalidListingsCopy', () => {
  it('says when every failed listing needs a photo, otherwise gives the generic count', () => {
    const photo = classifyListingPublishFailure(PHOTO_REQUIRED_MESSAGE);
    const other = classifyListingPublishFailure('x');
    expect(invalidListingsCopy([photo])).toBe(
      '1 listing needs a photo before it can be published. Download the result to see which.',
    );
    expect(invalidListingsCopy([photo, photo])).toMatch(/^2 listings need a photo before they can be published/);
    expect(invalidListingsCopy([photo, other])).toBe('2 listings were not published. Download the result to see why.');
    expect(invalidListingsCopy([other])).toBe('1 listing was not published. Download the result to see why.');
  });
});
