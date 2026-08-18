import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import { cx } from '../../lib/cx';

/**
 * Form controls with their labelling and error wiring in one place.
 *
 * Every field gets a real `<label for>`, and an error is joined to its input
 * through `aria-invalid` and `aria-describedby` — which is what lets the API's
 * per-field `issues[]` be announced rather than merely coloured red.
 */

const CONTROL =
  'w-full rounded-lg border bg-surface px-3 text-sm text-ink transition-colors placeholder:text-ink-faint disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted';

const CONTROL_HEIGHT = 'h-10';

function controlClasses(invalid: boolean, className?: string): string {
  return cx(
    CONTROL,
    CONTROL_HEIGHT,
    invalid ? 'border-critical' : 'border-line hover:border-line-strong',
    className,
  );
}

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div>
      {/* The required marker sits outside the label element on purpose: inside
          it, the asterisk becomes part of the control's accessible name and the
          field announces as "Customer star". */}
      <div className="mb-1.5 flex items-center gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-ink-soft">
          {label}
        </label>
        {required ? (
          <span className="text-critical" aria-hidden>
            *
          </span>
        ) : null}
      </div>

      {children}

      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, className, required, ...input }: TextFieldProps) {
  const id = useId();

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        id={id}
        className={controlClasses(error !== undefined, className)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        {...input}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  options: readonly SelectOption[];
  /** Leading option for "no filter" or "not chosen yet". */
  placeholder?: string;
}

export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  required,
  ...select
}: SelectFieldProps) {
  const id = useId();

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <select
        id={id}
        className={cx(controlClasses(error !== undefined, className), 'pr-8')}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        {...select}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  hint?: string;
}

export function CheckboxField({ label, hint, className, ...input }: CheckboxFieldProps) {
  const id = useId();

  return (
    <div className="flex gap-3">
      <input
        id={id}
        type="checkbox"
        className={cx(
          'mt-0.5 size-4 shrink-0 rounded border-line-strong text-brand accent-[var(--color-brand)]',
          className,
        )}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      <span className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink-soft">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-muted">
            {hint}
          </p>
        ) : null}
      </span>
    </div>
  );
}

/** A bare control for table cells and toolbars, where a visible label is elsewhere. */
export function BareSelect({
  label,
  options,
  className,
  ...select
}: { label: string; options: readonly SelectOption[] } & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id'
>) {
  return (
    <select
      aria-label={label}
      className={cx(controlClasses(false, className), 'pr-8')}
      {...select}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
