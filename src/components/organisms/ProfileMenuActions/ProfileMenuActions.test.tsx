import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MENU_VARIANT } from '@/config/ui';
import { ProfileMenuActions } from './ProfileMenuActions';

vi.mock('@/atoms/DropdownMenu/DropdownMenu', () => {
  return {
    DropdownMenu: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <div data-testid="dropdown-menu" data-open={open.toString()}>
        <button data-testid="dropdown-open-trigger" onClick={() => onOpenChange(true)} />
        {children}
      </div>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
      <div data-testid="dropdown-trigger">{children}</div>
    ),
    DropdownMenuContent: ({
      children,
      align,
      className,
    }: {
      children: React.ReactNode;
      align: string;
      className?: string;
      onCloseAutoFocus?: (e: { preventDefault: () => void }) => void;
    }) => (
      <div data-testid="dropdown-content" data-align={align} className={className}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/atoms/Sheet/Sheet', () => {
  return {
    Sheet: ({
      children,
      open,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <div data-testid="sheet" data-open={open.toString()}>
        {children}
      </div>
    ),
    SheetTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
      <div data-testid="sheet-trigger">{children}</div>
    ),
    SheetContent: ({
      children,
      side,
    }: {
      children: React.ReactNode;
      side: string;
      onOpenAutoFocus?: (e: { preventDefault: () => void }) => void;
    }) => (
      <div data-testid="sheet-content" data-side={side}>
        {children}
      </div>
    ),
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet-header">{children}</div>,
    SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="sheet-title" className={className}>
        {children}
      </div>
    ),
  };
});

const { mockUseIsMobile, mockUseProfileMenuActions, mockRequireAuth } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
  mockUseProfileMenuActions: vi.fn((_userId: string) => ({
    menuItems: [] as unknown[],
    isLoading: false,
  })),
  mockRequireAuth: vi.fn((action: () => void) => action()),
}));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock('@/hooks/useProfileMenuActions/useProfileMenuActions', () => ({
  useProfileMenuActions: (userId: string) => mockUseProfileMenuActions(userId),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({
    isAuthenticated: true,
    requireAuth: mockRequireAuth,
  }),
}));

vi.mock('./ProfileMenuActionsContent/ProfileMenuActionsContent', () => ({
  ProfileMenuActionsContent: ({
    userId,
    variant,
    onActionComplete,
  }: {
    userId: string;
    variant: string;
    onActionComplete?: () => void;
  }) => (
    <div data-testid="profile-menu-actions-content" data-user-id={userId} data-variant={variant}>
      <button onClick={onActionComplete}>Close</button>
    </div>
  ),
}));

vi.mock('@/atoms/Container/Container', () => {
  return {
    Container: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
      overrideDefaults?: boolean;
    }) => (
      <div data-testid="container" className={className}>
        {children}
      </div>
    ),
  };
});

describe('ProfileMenuActions', () => {
  const trigger = <button>Menu</button>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  it('renders the trigger inside a dropdown menu on desktop', () => {
    render(<ProfileMenuActions userId="pk:test123" trigger={trigger} />);

    expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('dropdown-trigger')).toContainElement(screen.getByRole('button', { name: 'Menu' }));
  });

  it('renders the menu content with the dropdown variant and user id on desktop', () => {
    render(<ProfileMenuActions userId="pk:test123" trigger={trigger} />);

    expect(screen.getByTestId('dropdown-content')).toHaveAttribute('data-align', 'end');
    const content = screen.getByTestId('profile-menu-actions-content');
    expect(content).toHaveAttribute('data-user-id', 'pk:test123');
    expect(content).toHaveAttribute('data-variant', MENU_VARIANT.DROPDOWN);
  });

  it('requires auth when opening the menu and closes on action complete', () => {
    render(<ProfileMenuActions userId="pk:test123" trigger={trigger} />);

    fireEvent.click(screen.getByTestId('dropdown-open-trigger'));
    expect(mockRequireAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dropdown-menu')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('dropdown-menu')).toHaveAttribute('data-open', 'false');
  });

  it('renders a bottom sheet with the sheet variant on mobile', () => {
    mockUseIsMobile.mockReturnValue(true);
    render(<ProfileMenuActions userId="pk:test123" trigger={trigger} />);

    expect(screen.getByTestId('sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('dropdown-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('sheet-content')).toHaveAttribute('data-side', 'bottom');
    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Profile Actions');

    const content = screen.getByTestId('profile-menu-actions-content');
    expect(content).toHaveAttribute('data-user-id', 'pk:test123');
    expect(content).toHaveAttribute('data-variant', MENU_VARIANT.SHEET);
  });
});
