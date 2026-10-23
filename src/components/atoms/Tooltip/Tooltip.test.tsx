import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from './Tooltip';

describe('Tooltip', () => {
  it('renders tooltip content when open', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button">Hover me</button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Tooltip body</TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole('tooltip')).toHaveTextContent('Tooltip body');
  });
});

describe('Tooltip - Rendering', () => {
  function renderOpenTooltip(contentProps?: ComponentProps<typeof TooltipContent>) {
    return render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent {...contentProps}>Tooltip label</TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </TooltipProvider>,
    );
  }

  it('renders the trigger', () => {
    renderOpenTooltip();
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
  });

  // Radix renders the visible content in a portal; role="tooltip" is a
  // visually-hidden accessibility span, so query the content by its slot.
  function getTooltipContent() {
    return document.querySelector('[data-slot="tooltip-content"]') as HTMLElement;
  }

  it('renders the content with the tooltip-content slot and base classes when open', () => {
    renderOpenTooltip();
    const content = getTooltipContent();
    expect(content).toBeInTheDocument();
    expect(content).toHaveTextContent('Tooltip label');
    expect(content).toHaveClass('z-50', 'rounded-md', 'bg-primary', 'text-xs', 'text-primary-foreground');
  });

  it('renders the arrow', () => {
    renderOpenTooltip();
    const arrow = getTooltipContent().querySelector('svg');
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveClass('fill-primary');
  });

  it('merges a custom className on the content', () => {
    renderOpenTooltip({ className: 'custom-tooltip' });
    expect(getTooltipContent()).toHaveClass('bg-primary', 'custom-tooltip');
  });

  it('sets data-side from the side prop', () => {
    renderOpenTooltip({ side: 'bottom' });
    expect(getTooltipContent()).toHaveAttribute('data-side', 'bottom');
  });
});
