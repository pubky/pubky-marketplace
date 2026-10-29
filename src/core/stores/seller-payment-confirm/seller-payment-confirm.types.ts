export interface SellerPaymentConfirmState {
  /**
   * Per signed-in pubky: whether this browser confirms that seller's matching
   * payments automatically while their Shop is open. On unless the seller
   * turned it off here (`false`); no entry means on.
   */
  autoConfirmByPubky: Record<string, boolean>;
}

export interface SellerPaymentConfirmActions {
  setAutoConfirm: (pubky: string, enabled: boolean) => void;
  /** Forgets every choice made in this browser, so each pubky is back to the default (on). */
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
