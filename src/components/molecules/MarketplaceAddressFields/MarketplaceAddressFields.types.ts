import type { Control, FieldValues, UseFormSetValue } from 'react-hook-form';
import type { AddressAutocompleteProvider } from '@/libs/commerce/address-autocomplete';

export type MarketplaceAddressFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  disabled?: boolean;
  autocompleteProvider?: AddressAutocompleteProvider | null;
  /** When set and non-empty, the country is chosen from these codes instead of typed. */
  allowedCountries?: readonly string[] | null;
};
