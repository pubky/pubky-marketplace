import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/libs/utils/utils';

/**
 * A button that reads as an inline link. Use it for text that opens something on the page (a
 * dialog) rather than navigating: unlike a `span` or `a` without `href` it is focusable, opens
 * on Enter and Space, and shows a focus ring. Works as a Radix `asChild` trigger.
 */
export const LinkButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function LinkButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline cursor-pointer rounded-sm text-sm font-medium text-brand outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
});
