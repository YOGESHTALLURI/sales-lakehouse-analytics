import { useCallback, useMemo, useRef, useState } from 'react';
import { isAbortError, isApiRequestError } from '../api/http';

/**
 * One write request, with the API's per-field errors already unpacked.
 *
 * The contract returns `issues[]` with dotted paths on a 400, so mapping them to
 * inputs belongs here rather than in each form: every form then points at the
 * offending field instead of showing one banner and leaving the user to guess.
 */

export interface SubmitResult<R> {
  readonly submitting: boolean;
  readonly error: unknown;
  /** Field path → message, e.g. `email` or `items.1.quantity`. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly result: R | undefined;
  readonly submit: (input: unknown) => void;
  readonly reset: () => void;
}

export function useSubmit<I, R>(action: (input: I) => Promise<R>): SubmitResult<R> {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [result, setResult] = useState<R | undefined>(undefined);

  // Held in a ref so an inline arrow function does not change `submit`'s identity
  // on every render.
  const latest = useRef(action);
  latest.current = action;

  const submit = useCallback((input: unknown) => {
    setSubmitting(true);
    setError(undefined);
    setResult(undefined);

    latest.current(input as I).then(
      (value) => {
        setSubmitting(false);
        setResult(value);
      },
      (caught: unknown) => {
        setSubmitting(false);
        if (!isAbortError(caught)) setError(caught);
      },
    );
  }, []);

  const reset = useCallback(() => {
    setSubmitting(false);
    setError(undefined);
    setResult(undefined);
  }, []);

  const fieldErrors = useMemo(
    () => (isApiRequestError(error) ? error.fieldErrors() : {}),
    [error],
  );

  return { submitting, error, fieldErrors, result, submit, reset };
}

/**
 * A `409` names the field it conflicts on only in prose, so the form decides
 * which input to blame. This keeps that decision in one testable place.
 */
export function conflictField(error: unknown, field: string): string | undefined {
  if (!isApiRequestError(error) || error.status !== 409) return undefined;
  return field;
}
