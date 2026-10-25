import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_LABELS } from '@/libs/status/status.constants';
import { StatusPickerWrapper } from './StatusPickerWrapper';

// Mock StatusPickerContent
vi.mock('../StatusPickerContent/StatusPickerContent', () => ({
  StatusPickerContent: ({
    onStatusSelect,
    currentStatus,
  }: {
    onStatusSelect: (status: string) => void;
    currentStatus?: string;
  }) => (
    <div data-testid="status-picker-content">
      <button data-testid="select-status-available" onClick={() => onStatusSelect('available')}>
        Available
      </button>
      <button data-testid="select-status-away" onClick={() => onStatusSelect('away')}>
        Away
      </button>
      <div data-testid="current-status">{currentStatus || 'none'}</div>
    </div>
  ),
}));

const { mockUseIsMobile } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
}));

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

describe('StatusPickerWrapper', () => {
  const mockOnStatusChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('renders emoji and status correctly for predefined status', () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      expect(screen.getByText('🌴')).toBeInTheDocument();
      expect(screen.getByText(STATUS_LABELS.vacationing)).toBeInTheDocument();
    });

    it('renders emoji and status correctly for custom status', () => {
      render(<StatusPickerWrapper emoji="😊" status="😊Working hard" />);

      expect(screen.getByText('😊')).toBeInTheDocument();
      expect(screen.getByText('Working hard')).toBeInTheDocument();
    });

    it('renders chevron icon', () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      const chevron = screen.getByText('🌴').closest('button')?.querySelector('svg');
      expect(chevron).toBeInTheDocument();
    });
  });

  describe('Status Selection', () => {
    it('calls onStatusChange when status is selected', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" onStatusChange={mockOnStatusChange} />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });

      const availableButton = screen.getByTestId('select-status-available');
      fireEvent.click(availableButton);

      await waitFor(() => {
        expect(mockOnStatusChange).toHaveBeenCalledWith('available');
      });
    });

    it('closes popover after status selection', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" onStatusChange={mockOnStatusChange} />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });

      const availableButton = screen.getByTestId('select-status-available');
      fireEvent.click(availableButton);

      await waitFor(() => {
        expect(screen.queryByTestId('status-picker-content')).not.toBeInTheDocument();
      });
    });

    it('updates local status when status is selected', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" onStatusChange={mockOnStatusChange} />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });

      const availableButton = screen.getByTestId('select-status-available');
      fireEvent.click(availableButton);

      // Re-open to check current status
      await waitFor(() => {
        expect(screen.queryByTestId('status-picker-content')).not.toBeInTheDocument();
      });

      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('current-status')).toHaveTextContent('available');
      });
    });
  });

  describe('Popover Behavior', () => {
    it('opens popover when trigger is clicked', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });
    });

    it('passes current status to StatusPickerContent', async () => {
      render(<StatusPickerWrapper emoji="👋" status="available" />);

      const triggerButton = screen.getByText('👋').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('current-status')).toHaveTextContent('available');
      });
    });

    it('rotates chevron when popover is open', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      const triggerButton = screen.getByText('🌴').closest('button');
      const chevron = triggerButton?.querySelector('svg');

      expect(chevron).not.toHaveClass('rotate-180');

      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(chevron).toHaveClass('rotate-180');
      });
    });
  });

  describe('Mobile Behavior', () => {
    it('uses a Popover without the Sheet title on desktop', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      fireEvent.click(screen.getByText('🌴').closest('button')!);

      await waitFor(() => {
        expect(document.querySelector('[data-slot="popover-content"]')).toBeInTheDocument();
      });
      expect(screen.queryByText('Select Status')).not.toBeInTheDocument();
    });

    it('uses a titled bottom Sheet instead of the Popover on mobile', async () => {
      mockUseIsMobile.mockReturnValue(true);
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" onStatusChange={mockOnStatusChange} />);

      fireEvent.click(screen.getByText('🌴').closest('button')!);

      const sheet = await screen.findByRole('dialog', { name: 'Select Status' });
      expect(sheet).toHaveAccessibleDescription('Choose a status to display on your profile');
      expect(sheet).toContainElement(screen.getByTestId('status-picker-content'));
      expect(document.querySelector('[data-slot="popover-content"]')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('select-status-away'));

      expect(mockOnStatusChange).toHaveBeenCalledWith('away');
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Select Status' })).not.toBeInTheDocument();
      });
    });
  });

  describe('Custom Configuration', () => {
    it('uses default sideOffset when not provided', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });
    });

    it('uses custom sideOffset when provided', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" sideOffset={-50} />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });
    });

    it('accepts zero as sideOffset', async () => {
      render(<StatusPickerWrapper emoji="🌴" status="vacationing" sideOffset={0} />);

      const triggerButton = screen.getByText('🌴').closest('button');
      fireEvent.click(triggerButton!);

      await waitFor(() => {
        expect(screen.getByTestId('status-picker-content')).toBeInTheDocument();
      });
    });
  });
});
