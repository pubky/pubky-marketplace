export interface NotificationStore {
  marketplaceUnread: number;
  setMarketplaceUnread: (marketplaceUnread: number) => void;
  selectMarketplaceUnread: () => number;
  reset: () => void;
}
