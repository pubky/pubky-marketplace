import { useEffect, useRef, useState } from 'react';

/** Shows a resized image when available and switches to its original once after a load error. */
export function useVariantImageFallback(
  variantSrc: string | undefined,
  mainSrc: string,
): { src: string; onError: () => void } {
  const initialSrc = variantSrc ?? mainSrc;
  const [src, setSrc] = useState(initialSrc);
  const hasFallenBackToMainRef = useRef(initialSrc === mainSrc);

  useEffect(() => {
    const nextSrc = variantSrc ?? mainSrc;
    setSrc(nextSrc);
    hasFallenBackToMainRef.current = nextSrc === mainSrc;
  }, [mainSrc, variantSrc]);

  const onError = () => {
    if (hasFallenBackToMainRef.current || src === mainSrc) return;

    hasFallenBackToMainRef.current = true;
    setSrc(mainSrc);
  };

  return { src, onError };
}
