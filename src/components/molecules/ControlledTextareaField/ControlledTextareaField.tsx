'use client';

import { Controller, FieldValues } from 'react-hook-form';
import { Container } from '@/atoms/Container/Container';
import { Label } from '@/atoms/Label/Label';
import { FORM_LABEL_CLASSES, FORM_REQUIRED_LABEL_CLASSES } from '@/config/forms';
import { cn } from '@/libs/utils/utils';
import { TextareaField } from '../TextareaField/TextareaField';
import type { ControlledTextareaFieldProps } from './ControlledTextareaField.types';

export function ControlledTextareaField<T extends FieldValues>({
  name,
  control,
  label,
  markRequired = false,
  placeholder,
  maxLength,
  variant = 'dashed',
  rows = 4,
  disabled = false,
  className,
  textareaClassName,
}: ControlledTextareaFieldProps<T>) {
  return (
    <Container className="gap-2">
      <Label
        htmlFor={name}
        className={cn(FORM_LABEL_CLASSES, markRequired && FORM_REQUIRED_LABEL_CLASSES)}
        data-required={markRequired || undefined}
      >
        {label}
      </Label>
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState }) => (
          <TextareaField
            id={name}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            variant={variant}
            rows={rows}
            maxLength={maxLength}
            disabled={disabled}
            className={className}
            textareaClassName={textareaClassName}
            aria-required={markRequired || undefined}
            status={fieldState.error ? 'error' : 'default'}
            message={fieldState.error?.message}
            messageType={fieldState.error ? 'error' : 'default'}
          />
        )}
      />
    </Container>
  );
}
