# Social features in the Shop

Seller keywords, category and condition belong to the owner-signed Market listing. The catalog filters on those fields. Community tags belong to the person who applied them. The listing page displays them separately under “Seller’s keywords” and “Community tags”.

## Community tags and follows

`pubky-market-specs` builds the canonical listing and shop URIs. Tag targets keep the same URI across social versions.

- An account with a confirmed legacy profile and its existing write grant can write a 0.x tag or follow until that account migrates. The public Nexus switches which records it indexes for the author when it sees the v1 profile.
- Once the public Nexus serves v1, the Shop checks for the owner’s v1 profile and a matching embedded App grant covering `/pub/social/v1/`. A standalone user can open the same listing or shop inside Pubky App. The existing Shop grant still covers commerce.
- The Shop reads v1 tag aggregates from the public social Nexus at `GET /v1/resource/by-uri`. The viewer’s own `tag_uri` identifies the record to remove. Before the transition, aggregate reads use the Marketplace index’s listing and shop tag endpoints. The local `marketplace_tags` cache reconciles optimistic writes.
- Automatic seller and moderation follows require write access. Their once-only markers preserve an explicit unfollow.

## Navigation and collections

Pubky App serves feeds, Hot, profiles and collection pages. Existing Shop links to those pages open the corresponding App route. The Shop continues to serve its catalog, listing and shop pages, messages and transaction notifications.

The listing page offers Watchlist and sharing. Sharing opens the App composer with the listing link. Watchlist has its own encrypted sync and works with a standalone Shop grant. Existing public collections and their listing references remain in their owners’ homeservers.

For deployment checks covering profiles, grants and moderation, see the [release guide](release.md#verify-the-shop-with-the-social-v1-app-release).
