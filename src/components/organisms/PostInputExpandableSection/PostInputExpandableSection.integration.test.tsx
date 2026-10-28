import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from '@/hooks/useIsMobile/useIsMobile';
import { POST_INPUT_VARIANT } from '../PostInput/PostInput.constants';
import { PostInputExpandableSection } from './PostInputExpandableSection';

vi.mock('@/hooks/useIsMobile/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

const defaultProps = {
  content: '',
  tags: [],
  isSubmitting: false,
  isArticle: false,
  submitMode: POST_INPUT_VARIANT.REPLY,
  setTags: vi.fn(),
  onSubmit: vi.fn(),
  showEmojiPicker: false,
  setShowEmojiPicker: vi.fn(),
  onEmojiSelect: vi.fn(),
};

describe('PostInputExpandableSection - Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it('renders the real action bar with the tag input', () => {
    render(<PostInputExpandableSection {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Add new tag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeEnabled();
  });

  it('disables the reply button when there is no content', () => {
    render(<PostInputExpandableSection {...defaultProps} />);

    const reply = screen.getByRole('button', { name: 'Reply' });
    expect(reply).toBeDisabled();
    expect(reply).toHaveAttribute('data-cy', 'post-input-action-bar-reply');
  });

  it('enables the reply button when there is content', () => {
    render(<PostInputExpandableSection {...defaultProps} content="Hello world" />);

    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled();
  });

  it('uses the small post button on desktop', () => {
    render(<PostInputExpandableSection {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Reply' })).toHaveAttribute('data-size', 'sm');
  });

  it('uses the default-size post button on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<PostInputExpandableSection {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Reply' })).toHaveAttribute('data-size', 'default');
  });
});
