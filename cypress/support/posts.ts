// wait for feed timeline to not show placeholder text
// Scopes checks to the main feed container only so sidebar/drawer content (e.g. "Loading posts...", "No posts found") does not affect readiness.
export const waitForFeedToLoad = () => {
  const checkTimelineRecursively = (attempts: number, firstCheck: boolean = true) => {
    if (attempts <= 0)
      assert(false, "Timeline still shows either no posts, 'No posts found' or 'Loading...' after 10 seconds");

    cy.get('body').then(($body) => {
      const $feed = $body.find('[data-cy="timeline-container"]');
      if ($feed.length === 0) {
        firstCheck ? cy.wait(200) : cy.wait(1000);
        checkTimelineRecursively(attempts - 1, false);
        return;
      }

      const feedText = $feed.text();
      const normalisedFeedText = feedText.replace(/\s+/g, ' ').trim();
      const hasTimelinePosts = $feed.find('[data-cy="timeline-posts"]').length > 0;
      const hasEmptyState = normalisedFeedText.includes('No posts found');
      const isLoadingPosts = normalisedFeedText.includes('Loading posts...');
      const isLoadingHeader = normalisedFeedText.includes('Loading header...');
      const isLoadingContent = normalisedFeedText.includes('Loading content...');

      cy.log('hasTimelinePosts: ', String(hasTimelinePosts));
      cy.log('hasEmptyState: ', String(hasEmptyState));
      cy.log('isLoadingPosts: ', String(isLoadingPosts));
      cy.log('isLoadingHeader: ', String(isLoadingHeader));
      cy.log('isLoadingContent: ', String(isLoadingContent));

      // Feed has loaded if:
      // 1. Not loading anymore AND
      // 2. Either timeline-posts exists (has posts) OR empty state is shown (no posts)
      if (!isLoadingPosts && !isLoadingHeader && !isLoadingContent && (hasTimelinePosts || hasEmptyState)) {
        // Feed has loaded successfully
        return;
      }

      // Still waiting for feed to load
      firstCheck ? cy.wait(200) : cy.wait(1000);
      checkTimelineRecursively(attempts - 1, false);
    });
  };

  checkTimelineRecursively(10);
};
