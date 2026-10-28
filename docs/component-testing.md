# Component Testing

Rules and patterns for unit tests for UI components.

Behaviour and prop contracts belong in unit tests; appearance belongs in VRT
(`docs/visual-regression-testing.md`). Snapshot tests (`toMatchSnapshot`) were
removed — do not add new ones.

## File Naming

Each UI component should have a corresponding test file in the same directory.
Example: `Button.tsx` → `Button.test.tsx`

## Unit Test Structure

### Sanity Tests

Add at least one sanity test to confirm UI renders with expected elements and attributes:

```typescript
it('renders with default props', () => {
  render(<Button>Default Button</Button>);
  const button = screen.getByRole('button');
  expect(button).toBeInTheDocument();
  expect(button).toHaveAttribute('data-slot', 'button');
});
```

### Functional Tests

Test interactive behavior like click handlers and hover states:

```typescript
it('handles click events', () => {
  const handleClick = vi.fn();
  render(<Button onClick={handleClick}>Click me</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});

it('handles hover states correctly', () => {
  render(<Button variant="default">Hover Button</Button>);
  const button = screen.getByRole('button');
  expect(button).toHaveClass('hover:!bg-brand/30');
});
```

### Prop Mapping (atoms and primitives)

For atoms and other primitives where props map to elements or classes, assert
the mapping directly: `as="h2"` renders an `h2`, `variant="destructive"` sets
`data-variant`, `size="lg"` applies its size class. Prefer `data-*` attributes
and roles over class names where the component exposes them; assert a class
only when it is the contract (a CVA variant, a passthrough `className`). Cover
the default variant as well as the named ones. Do not rely on VRT alone for
these contracts — a variant that only appears off-screen is never captured.

```typescript
it.each([
  ['default', ['h-9', 'px-2', 'min-w-9']],
  ['sm', ['h-8', 'px-1.5', 'min-w-8']],
  ['lg', ['h-10', 'px-2.5', 'min-w-10']],
] as const)('applies size="%s" classes', (size, classes) => {
  render(<Toggle size={size}>Toggle</Toggle>);
  expect(screen.getByRole('button')).toHaveClass(...classes);
});

it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)('renders as <%s> when as="%s"', (as) => {
  render(<Typography as={as}>Text</Typography>);
  expect(screen.getByTestId('typography').tagName).toBe(as.toUpperCase());
});
```

### Viewport-Dependent Components

When a component branches on `useIsMobile` (directly or via a child), assert
the branch by mocking the hook — desktop and mobile each get a targeted test:

```typescript
it('renders a bottom sheet on mobile', () => {
  mockUseIsMobile.mockReturnValue(true);
  render(<ProfileMenuActions userId="pk:test123" trigger={<button>Menu</button>} />);
  expect(screen.getByTestId('sheet')).toBeInTheDocument();
});
```

Do not stub the viewport-aware child with a passthrough mock — that hides the
branch. Mobile appearance (390×844) is covered by VRT, not by jsdom window
resizing.

## Test Optimization

- Unit tests should focus on functional behavior, prop contracts, and logic
- Appearance (layout, styling, responsive behaviour) is owned by VRT — do not
  duplicate it with structural assertions beyond the prop contract

## Mocking Rules

### Default: Use Real Implementations

Always prefer real implementations from concrete `@/libs/*` files for pure functions and business logic:

```typescript
import { formatPublicKey, truncateString } from '@/libs/utils/utils';
// No mocking needed for pure functions
```

### When to Mock

Mock only for:

1. **External API calls** — prevent actual network requests
2. **File system operations** — avoid touching the file system
3. **Database connections** — avoid actual DB connections in component tests
4. **Time/Randomness** — use `vi.useFakeTimers()` for deterministic tests
5. **Error conditions** — simulate error scenarios

### Selective Mocking

```typescript
vi.mock('@/libs/logger/logger', async () => {
  const actual = await vi.importActual<typeof import('@/libs/logger/logger')>('@/libs/logger/logger');
  return {
    ...actual,
    Logger: { ...actual.Logger, error: vi.fn() },
  };
});
```

### Typed Mocks: No `as unknown as T` or `as any`

ESLint bans both `as any` and `as unknown as T` in every `*.test.{ts,tsx}` file (via `no-restricted-syntax` in `eslint.config.mjs`). Both patterns silently switch off TypeScript on the mock and let a bad shape sail through for the lifetime of the test.

Route every cast in a test through a named helper from `src/test-utils` instead. See `src/test-utils/README.md` for the full list, but in short:

| Situation                                                            | Helper                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| Partial Zustand store double                                         | `mockAuthStore({...})`, `mockHomeStore({...})`, etc.     |
| Partial React synthetic event                                        | `mockKeyboardEvent({...})`, `mockDragEvent({...})`, etc. |
| Partial `@synonymdev/pubky` `Session` / `Keypair`                    | `mockSession({...})` / `mockKeypair({...})`              |
| Partial `fetch` `Response`                                           | `mockResponse({...})`                                    |
| Deliberately invalid input to exercise a runtime guard               | `asInvalid<T>(value)`                                    |
| Opaque external SDK type with no constructor and no dedicated helper | `asOpaque<T>(value)`                                     |

Each helper takes a `Partial<T>` (or a named `T` type parameter) and buries the cast in one place, so the shape of the argument you pass is still type-checked and every remaining escape hatch is greppable.

```typescript
// Before — silently disables the type check on AuthStore and the keyboard event
import type { AuthStore } from '@/stores/auth/auth.types';

const authStore = {
  currentUserPubky: 'abc',
  signIn: vi.fn(),
} as unknown as AuthStore;

const event = { key: 'Enter', preventDefault: vi.fn() } as any;

// After — the helpers type-check the partials and add sensible defaults
import { mockKeyboardEvent } from '@/test-utils/react-events';
import { mockAuthStore } from '@/test-utils/stores';

const authStore = mockAuthStore({
  currentUserPubky: 'abc',
  signIn: vi.fn(),
});

const event = mockKeyboardEvent({ key: 'Enter' });
```

A single-step widening cast like `value as unknown` or `[] as unknown[]` (inside a `vi.hoisted` placeholder, for instance) is still allowed — it widens the type without bypassing any read-side check, so it's not an escape hatch. The rule only fires on the `unknown as T` second hop and on `as any`.

### Icon Components: Always Real

Stock Lucide icons imported from `lucide-react` and custom SVG icons from `@/icons` (`src/libs/icons/icons.tsx`) should **always** use real implementations in tests—do not `vi.mock('lucide-react')` or `vi.mock('@/icons')` to stub icons. This ensures visual regression tests capture real SVG output and detect icon changes.

Application import conventions (where to import icons, URL helpers, and what not to do) are documented in **`docs/components.md`** — _Icons (Lucide and custom)_.

### Radix UI Components: Always Real

Radix UI components (`Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tooltip`, `Accordion`) should **never** be mocked. This ensures:

- Tests validate actual behavior and context requirements
- Portal rendering works correctly
- Accessibility attributes are properly applied

## Deterministic Time Testing

Components displaying relative time (e.g., "2 hours ago") must use fake timers:

```typescript
describe('PostTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays relative time correctly', () => {
    const twoHoursAgo = new Date('2024-01-01T10:00:00Z');
    render(<PostTimestamp createdAt={twoHoursAgo} />);
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
  });
});
```

## Running Tests

```bash
npm test                             # All tests
npm test -- ComponentName.test.tsx   # Specific component
```

## Testing Workflow

1. Run tests after creating new test files
2. For atoms and primitives, assert the prop mapping directly — see [Prop Mapping](#prop-mapping-atoms-and-primitives)
3. Verify all tests pass before committing

## Complete Example

```typescript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Default Button</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button).toHaveAttribute('data-variant', 'default');
  });

  it.each([
    ['default', ['h-10', 'px-4']],
    ['sm', ['h-8', 'px-3']],
    ['lg', ['h-12', 'px-6']],
  ] as const)('applies size="%s" classes', (size, classes) => {
    render(<Button size={size}>Button</Button>);
    expect(screen.getByRole('button')).toHaveClass(...classes);
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```
