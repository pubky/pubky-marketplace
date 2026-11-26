import { useState } from 'react';

type FailedPair = { variantSrc: string; mainSrc: string };

/** Shows a resized image when available and switches to its original once after a load error. */
export function useVariantImageFallback(
  variantSrc: string | undefined,
  mainSrc: string,
): { src: string; onError: () => void } {
  const [failed, setFailed] = useState<FailedPair | null>(null);
  const variantFailed = failed?.variantSrc === variantSrc && failed?.mainSrc === mainSrc;
  const src = variantSrc && !variantFailed ? variantSrc : mainSrc;

  const onError = () => {
    if (!variantSrc || src === mainSrc) return;
    setFailed({ variantSrc, mainSrc });
  };

  return { src, onError };
}
