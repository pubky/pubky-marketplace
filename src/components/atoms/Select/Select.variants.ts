import { buttonVariants } from '@/atoms/Button/Button';
import { cn } from '@/libs/utils/utils';

/** Native and Radix commerce pickers share the secondary surface and keep their compact label treatment. */
export function secondarySelectClasses(size: 'default' | 'sm' = 'default') {
  return cn(buttonVariants({ variant: 'secondary', size }), 'gap-1.5 font-semibold');
}
