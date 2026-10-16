// Decides whether the buyer's "Buy" on a listing reached the cart, from what the browser observed.
//
// The listing's Buy button adds the selected variant to the cart. A buyer without a marketplace session (grant
// sessions off, or not yet minted) gets the "Enable purchases" dialog instead; once the buyer approves it, the
// Shop closes the dialog and runs the pending add to cart itself.
//
// observed: {
//   buyEnabled            the listing showed an enabled Buy button for the buyer
//   enablePurchases       clicking Buy opened the "Enable purchases" dialog
//   approvalLink          that dialog offered an authorization link to approve (unset when it never opened)
//   dialogClosed          the dialog closed after the buyer approved (unset when it never opened)
//   cartHasCheckout       the cart then showed its checkout control
// }
// Returns null when the listing is in the cart, else the reason it is not.
export function purchaseFailure({ buyEnabled, enablePurchases, approvalLink, dialogClosed, cartHasCheckout }) {
  if (!buyEnabled) {
    return 'the listing shows no enabled Buy button for the buyer (own listing, sold out, held, or transactions off)';
  }
  if (enablePurchases) {
    if (!approvalLink) {
      return '"Enable purchases" opened without an authorization link to approve (an approval in progress elsewhere?)';
    }
    if (!dialogClosed) return '"Enable purchases" did not close after the buyer approved it';
  }
  if (!cartHasCheckout) {
    return enablePurchases
      ? 'the listing was not in the cart after the "Enable purchases" approval'
      : 'the listing was not in the cart after Buy';
  }
  return null;
}
