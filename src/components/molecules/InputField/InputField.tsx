'use client';

import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Typography } from '@/atoms/Typography/Typography';
import { FORM_FIELD_SURFACE_CLASSES } from '@/config/forms';
import { cn } from '@/libs/utils/utils';

interface InputFieldProps {
  id?: string;
  name?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onClick?: () => void;
  onClickIcon?: () => void;
  className?: React.HTMLAttributes<HTMLDivElement>['className'];
  icon?: ReactNode;
  variant?: 'default' | 'dashed';
  loading?: boolean;
  loadingText?: string;
  loadingIcon?: ReactNode;
  status?: 'default' | 'success' | 'error';
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  maxLength?: number;
  iconPosition?: 'left' | 'right';
  message?: ReactNode;
  messageType?: 'default' | 'info' | 'alert' | 'error' | 'success';
  size?: 'sm' | 'md' | 'lg';
  dataCy?: string;
  inputClassName?: React.HTMLAttributes<HTMLInputElement>['className'];
  autoComplete?: string;
  /** Defaults to `text`; `password` masks a secret (such as a store key) as it is typed. */
  type?: 'text' | 'password';
  role?: React.AriaRole;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
  'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both';
  'aria-haspopup'?: React.AriaAttributes['aria-haspopup'];
  'aria-required'?: boolean;
}
export function InputField({
  id,
  name,
  value,
  placeholder,
  disabled = false,
  readOnly = false,
  onClick,
  onClickIcon = () => {},
  className,
  icon,
  variant = 'default',
  loading = false,
  loadingText,
  loadingIcon,
  status = 'default',
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onPaste,
  maxLength,
  iconPosition = 'left',
  message,
  messageType = 'default',
  size = 'md',
  dataCy,
  inputClassName,
  autoComplete,
  type = 'text',
  role,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  'aria-activedescendant': ariaActiveDescendant,
  'aria-autocomplete': ariaAutocomplete,
  'aria-haspopup': ariaHasPopup,
  'aria-required': ariaRequired,
}: InputFieldProps) {
  const resolvedLoadingText = loadingText ?? 'Loading...';
  const containerClasses = variant === 'dashed' && FORM_FIELD_SURFACE_CLASSES;
  const statusClasses = {
    default: '',
    success: 'border-brand text-brand',
    error: 'border-red-500 text-red-500',
  };
  const sizeClasses = {
    sm: 'h-10 text-sm',
    md: 'h-12 text-base',
    lg: 'h-14 text-lg',
  } as const;
  const messageClasses = {
    default: 'text-muted-foreground',
    info: 'text-blue-500',
    alert: 'text-yellow-500',
    error: 'text-red-500',
    success: 'text-brand',
  } as const;
  return (
    <>
      <Container
        className={cn(
          'mx-0 mb-2 w-full cursor-pointer flex-row items-center gap-0 rounded-md border !bg-background',
          icon && iconPosition === 'left' ? 'pl-4.5' : 'pl-2',
          containerClasses,
          statusClasses[status],
          loading && 'border-brand text-brand',
          sizeClasses[size],
          className,
        )}
      >
        {loading && (
          <Container className="w-auto items-center justify-center">
            {loadingIcon ?? (
              <Loader2 className="linear infinite h-4 w-4 animate-spin text-brand" data-testid="loading-icon" />
            )}
          </Container>
        )}
        {!loading && icon && iconPosition === 'left' && (
          <Container onClick={onClickIcon} className={cn('w-auto cursor-pointer items-center justify-center')}>
            {icon}
          </Container>
        )}
        <Input
          id={id}
          name={name}
          type={type}
          className={cn('w-full border-none !bg-transparent [.light_&]:shadow-none', inputClassName)}
          value={loading ? resolvedLoadingText : value}
          placeholder={placeholder}
          disabled={disabled || loading}
          readOnly={readOnly}
          onClick={onClick}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={maxLength}
          autoComplete={autoComplete}
          role={role}
          aria-expanded={ariaExpanded}
          aria-controls={ariaControls}
          aria-activedescendant={ariaActiveDescendant}
          aria-autocomplete={ariaAutocomplete}
          aria-haspopup={ariaHasPopup}
          aria-required={ariaRequired}
          aria-invalid={status === 'error'}
          aria-describedby={message && id ? `${id}-message` : undefined}
          data-cy={dataCy}
        />
        {!loading && icon && iconPosition === 'right' && (
          <Container onClick={onClickIcon} className={cn('mr-5 w-auto cursor-pointer items-center justify-center')}>
            {icon}
          </Container>
        )}
      </Container>
      {message && (
        <Typography
          id={id ? `${id}-message` : undefined}
          as="small"
          size="sm"
          className={cn('ml-1', messageClasses[messageType])}
        >
          {message}
        </Typography>
      )}
    </>
  );
}
