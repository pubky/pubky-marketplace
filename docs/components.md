# Component Development

Rules and patterns for developing UI components. Based on atomic design with Shadcn UI.

## Core Principles

### 1. Shadcn First

**ALWAYS check if Shadcn has an equivalent before creating custom components.**

```bash
npx shadcn@latest add [component] --yes
```

Then adapt to project structure. Don't recreate from scratch.

### 2. Figma Parity

**100% visual match with Figma designs** — no approximations.

- Use exact sizes, colors, spacing from Figma
- Verify using screenshots or MCP Figma tools
- Test all states (hover, focus, disabled, active)

Main Figma project: [shadcn_ui-PUBKY](https://www.figma.com/design/01ZvjSPZnKTNmaEWz0yJsq/shadcn_ui-PUBKY)

### 3. Atomic Design

```
atoms/     → Basic components (Button, Input, Avatar, Badge)
molecules/ → Atom combinations (InputField, SearchBar, PostCard)
organisms/ → Complex features (PostFeed, UserProfile, Forms)
templates/ → Page layouts
```

## File Structure

```
src/components/atoms/Button/
├── Button.tsx           # Main component
├── Button.test.tsx      # Unit tests
└── Button.types.ts      # Type definitions
```

Do not add `index.ts` / `index.tsx` under `src/components` whose sole job is re-exporting from child folders. Component folders expose their symbols directly from concrete files (for example `Button/Button.tsx`, not `Button/index.ts` that only re-exports).

### Config and app routes

- **Config:** import from `@/config/<topic>` (concrete modules under `src/config/`, such as `@/config/nexus`, `@/config/posts`). Do not introduce an aggregate `src/config/index.ts` that re-exports the whole tree.
- **Routes:** import route constants and helpers from `@/app/routes` (implemented in `src/app/routes.ts`). Use named imports; use `import type` when you only need types from a colocated `*.types.ts` file.

#### Explore mode (unauthenticated browsing)

Guests can open routes that do not require a session:

| Kind           | Paths                                                                           | `@/app/routes` helper  | `usePublicRoute()` flag |
| -------------- | ------------------------------------------------------------------------------- | ---------------------- | ----------------------- |
| Core explore   | `/home`, `/hot`, `/search`, `/collections`                                      | `isCoreExploreRoute`   | `isCoreExploreRoute`    |
| Dynamic public | `/post/[userId]/[postId]`, `/profile/[pubky]`, `/collections/[userId]/[postId]` | `isDynamicPublicRoute` | `isDynamicPublicRoute`  |
| Either         | —                                                                               | —                      | `isPublicExploreRoute`  |

- **Route guard:** `EXPLORE_ROUTES` is included in `UNAUTHENTICATED_ROUTES`; dynamic public paths are allowed via `isDynamicPublicRoute()` in `RouteGuardProvider`.
- **UI chrome:** use `usePublicRoute()` for layout (e.g. explore header, mobile footer on `/home`). `isPublicRoute` on the hook result is a **legacy alias** for `isDynamicPublicRoute` only—it is `false` on `/home` even though the page is browsable.
- **Auth-gated actions:** use `useRequireAuth().requireAuth()` for post, reply, follow, filters, etc. Streams for guests should use `REACH.ALL` (see `useStreamIdFromFilters`, `useHotStreamId`).

## Component Template

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/libs/utils/utils';

const buttonVariants = cva('inline-flex items-center justify-center rounded-md text-sm font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      outline: 'border border-input bg-background hover:bg-accent',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
    },
    size: {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-xs',
      lg: 'h-12 px-6',
      icon: 'h-10 w-10',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
));
Button.displayName = 'Button';

export { Button, buttonVariants };
```

## Imports and Exports

```tsx
// CORRECT
import { cn } from '@/libs/utils/utils';
import { Button } from '@/atoms/Button/Button';
import { PostHeader } from '@/organisms/PostHeader/PostHeader';

// WRONG
import { cn } from 'src/lib/utils';
import { cn } from '../../libs/utils';
// Do not import components through folder indexes or aggregate modules.
```

Use the component namespace aliases from `tsconfig.json` for non-local component imports:

- `@/atoms/*`
- `@/molecules/*`
- `@/organisms/*`
- `@/templates/*`

Import from the file that defines the symbol, not from a folder, tier, or aggregate module. For sibling components in the same atomic tier or feature subtree, prefer local relative imports.

```tsx
// Same component folder
import type { ButtonProps } from './Button.types';

// Sibling molecule
import { ProgressSteps } from '../ProgressSteps/ProgressSteps';

// Cross-tier or app-level consumer
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';
```

Route files that only render a template can re-export the template directly:

```tsx
export { Home as default } from '@/templates/Feed/Home/Home';
```

## Icons (Lucide and custom)

Icons are split on purpose: **stock Lucide** ships from the `lucide-react` package; **app-owned SVGs** (brands, bespoke marks, non-Lucide shapes) live in a single module behind the **`@/icons`** path alias (`src/libs/icons/icons.tsx`).

### Stock Lucide icons

```tsx
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
```

Use named imports from `lucide-react` only.

### Custom / brand icons

```tsx
import { MarkdownMark, UsersRound2 } from '@/icons';
```

The `@/icons` alias is defined in `tsconfig.json` and points at `src/libs/icons/icons.tsx`. Add new custom components there; keep them out of generic libs utility modules.

### URL → icon / label helpers

**`getIconFromUrl`** lives in **`@/libs/utils/urlToIcon`** (`src/libs/utils/urlToIcon.ts`). It returns icon component types for link previews — import it from `@/libs/utils/urlToIcon`, not from `@/icons`.

### Tests

Component tests must use **real** `lucide-react` and `@/icons` implementations (no `vi.mock('lucide-react')` / `vi.mock('@/icons')` for icons). See `docs/component-testing.md` — _Icon components: Always Real_.

## Unsaved changes

A settings form that is not auto-saved guards its edits with [`useUnsavedChangesGuard`](../src/hooks/useUnsavedChangesGuard/useUnsavedChangesGuard.ts) and [`UnsavedChangesDialog`](../src/components/molecules/Marketplace/UnsavedChangesDialog.tsx): pass the form's dirty flag (for a form with images, include them, as `useMarketplaceShopSettings().isDirty` does). While dirty, closing or reloading the tab asks through the browser, and a click on a link to another page of the site is held back until the seller chooses Keep editing or Discard changes. Hash-only links, new-tab links, downloads and modifier-clicks are not held back. The browser's Back button cannot be intercepted by an app-router page, so it is not covered. The Storefront page (`MarketplaceMyShop`) uses it.

## Toasts

Use [`toast()`](../src/components/molecules/Toaster/toast.ts) from `@/molecules/Toaster/toast` in components, hooks and providers. `<Toaster />` is mounted in the app layout. The store, subscription hook and Radix atoms are internal; callers do not subscribe to toast state.

### Variants (`ToastVariant`)

| Variant   | Use for                                          |
| --------- | ------------------------------------------------ |
| `default` | Success, confirmation, neutral completion        |
| `error`   | Failures, validation errors, caught exceptions   |
| `warning` | Caution, rate limits, recoverable problems       |
| `info`    | Informational feedback, including clipboard copy |

Omit `title` on an error toast to display the fallback “Error”. Icons are custom filled shapes in `Toast.icons.tsx`, wired through `TOAST_ICONS` in `Toast.variants.ts`.

### Calling `toast()`

```tsx
import { toast } from '@/molecules/Toaster/toast';

toast({ title: 'Saved' });
toast({ variant: 'error', description: 'Could not save your changes.' });

toast({
  title: 'Item removed from cart',
  durationMs: 5_000,
  action: { label: 'Undo', altText: 'Restore the removed item', onClick: restoreItem },
});
```

- Supply at least one of `title` or `description`, both strings. JSX, `className` and Radix props are not part of the public API.
- `action` is `{ label, altText, onClick }`. The renderer dismisses the current toast before invoking the callback, so a replacement toast stays open. All custom action buttons use the neutral App style.
- `dismissButton: true` adds a separate OK button. It uses brand styling for the default variant and neutral styling for other variants.
- The returned handle exposes only `dismiss()`. Callers cannot read or update internal toast state.
- Ordinary toasts expire after **3 seconds**. Set `durationMs` for a finite extension: cart Undo uses **5 seconds**, and wallet setup/retry uses **60 seconds**. Durations must be finite, greater than zero and no greater than `2_147_483_647`; invalid runtime values fall back to 3 seconds.
- Only one transient toast is kept at a time, including messages with custom durations. A newer transient message replaces the previous one.
- `persistent: true` disables expiry and keeps that message outside the transient replacement limit until acted on or dismissed. Reserve it for state the user must resolve; do not use it to extend a wallet retry message. It cannot be combined with `durationMs`.
- The store owns expiry timers and cancels them on dismissal or replacement. Radix's timer is disabled to avoid competing deadlines. Dismissed toasts leave internal state after 20 seconds.
- Use `variant: 'error'` for errors; do not add `showErrorToast` / `showSuccessToast` wrappers or style overrides. Styling belongs in `Toast.variants.ts`.

### Tests

Mock `@/molecules/Toaster/toast` in feature unit tests; assert the options and invoke action descriptors to exercise their callbacks. Toast integration tests render the real store and Radix renderer, including timing, action replacement and dismissal. Appearance belongs in `Toaster.vrt.test.tsx`.

## Forms

Build forms with `react-hook-form` and `zod` through `@hookform/resolvers/zod`. Use
`src/hooks/useCreateCollection/useCreateCollection.ts` and its sibling `useCreateCollection.types.ts`
as a reference for the hook/schema layout.

- The hook owns validation and the mutation. Components call a `use{Action}Form` or `use{Verb}{Entity}` hook that exposes
  `{ form, submit, reset, ... }`, instead of calling `commit*` controllers directly.
- `submit()` returns `Promise<boolean>` when the caller only needs success/failure, or a created entity ID as
  `Promise<string | null>` when navigation needs it, as in `useCreateCollection`. Preserve the caller's existing contract
  and keep closing or navigation in the caller.
- Put the Zod schema, `*_FORM_FIELDS` map, inferred type and default values in a sibling `*.types.ts` file.
- Use React Hook Form's `Controller` through `ControlledInputField` and `ControlledTextareaField` where applicable.
  Preserve field errors, loading/disabled states and required labels.
- Compose dedicated hooks for non-text inputs such as cover images and file pickers; their resource lifecycle does not
  belong in a text-field controller.
- Keep user-facing validation messages as literal US-English strings. Use Zod v4 `z.url()` for URL validation.
- Choose validation timing for the interaction being built. For example, `useCreateCollection` uses `onChange` so a blur
  error does not move the dialog close button during a click. Do not copy a different validation mode incidentally.
- Follow the existing error-handling and notification contracts; avoid logging an error again when its `Err.*` factory
  already logged it. See `error-handling.md` and the existing Toasts section above.

## Design System Integration

### Colors

```tsx
// Use design tokens
<div className="bg-primary text-primary-foreground" />
<div className="bg-muted text-muted-foreground" />

// Don't hardcode
<div style={{ backgroundColor: '#ffffff' }} />
<div className="bg-[#1a1a1a]" />
```

### Sizing

```tsx
// Follow Figma scale
<Avatar className="h-10 w-10" />  // 40px
<Avatar className="h-8 w-8" />    // 32px

// No arbitrary sizes
<Avatar className="h-[37px] w-[37px]" />
```

### Spacing

```tsx
// Use Tailwind spacing scale
<div className="p-4 gap-2 space-y-4" />

// No arbitrary spacing
<div className="p-[13px]" />
```

## Ref Forwarding

```tsx
// CORRECT — Forward refs
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => <button ref={ref} {...props} />);

// WRONG — Missing forwardRef
const Button = (props: ButtonProps) => <button {...props} />;
```

## Figma Integration Workflow

### Available MCP Tools

- `get_metadata` — Component structure and metadata
- `get_code` — Generate UI code from Figma nodes
- `get_screenshot` — Visual comparison screenshots
- `get_variable_defs` — Design tokens and variables

### Workflow

1. Get metadata to understand component structure
2. Extract code for initial implementation
3. Compare screenshots for visual parity
4. Extract design tokens for consistent styling

## Migration Checklist

When migrating/creating a component:

- [ ] Shadcn equivalent checked
- [ ] Figma design analyzed
- [ ] Shadcn installed if available
- [ ] Placed at correct atomic level
- [ ] Utilities from concrete `@/libs/*` files (e.g. `cn` from `@/libs/utils/utils`); **icons** from `lucide-react` or `@/icons` per [Icons (Lucide and custom)](#icons-lucide-and-custom)
- [ ] Component imports point at concrete files (e.g. `@/atoms/Button/Button`), not aggregate folder indexes or re-export-only paths
- [ ] All Figma variants implemented
- [ ] CVA used for variant management
- [ ] Tests created (unit) — see `docs/component-testing.md`
- [ ] Build passes (`npm run build`)
- [ ] Visual verification in browser

## Quick Checklist

When creating/modifying components:

- [ ] Shadcn checked first?
- [ ] File structure follows pattern?
- [ ] Using concrete `@/atoms/*`, `@/molecules/*`, `@/organisms/*`, or `@/templates/*` imports?
- [ ] Design tokens (not hardcoded colors)?
- [ ] Figma sizing/spacing matched?
- [ ] Tests created (unit)?
- [ ] No re-export-only `index.ts` / `index.tsx` added under `src/components`?
- [ ] Build passes?
