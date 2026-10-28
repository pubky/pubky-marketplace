export interface SellerPaymentConfirmState {
  /**
   * Per signed-in pubky: whether this browser confirms that seller's matching
   * payments automatically while their Shop is open. Off unless the seller
   * turns it on.
   */
  autoConfirmByPubky: Record<string, boolean>;
}

export interface SellerPaymentConfirmActions {
  setAutoConfirm: (pubky: string, enabled: boolean) => void;
  /** Turns the setting off for every pubky in this browser. */
  reset: () => void;
}

export type SellerPaymentConfirmStore = SellerPaymentConfirmState & SellerPaymentConfirmActions;

export const sellerPaymentConfirmInitialState: SellerPaymentConfirmState = {
  autoConfirmByPubky: {},
};

export enum SellerPaymentConfirmActionTypes {
  SET_AUTO_CONFIRM = 'sellerPaymentConfirm/setAutoConfirm',
  RESET = 'sellerPaymentConfirm/reset',
}
