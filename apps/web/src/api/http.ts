import type { ApiErrorCode, ValidationIssue } from './types';

/**
 * The transport seam.
 *
 * Everything above this line is typed against the contract; everything below is
 * either `fetch` or the fixture implementation. Swapping the two is what makes
 * `VITE_API_FIXTURES=0` a one-line change rather than a rewrite.
 */

export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface Transport {
  get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
}

/** Drop undefined entries so an unset filter never reaches the API as `?x=`. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * A failed request, carrying the contract's error envelope.
 *
 * `status` is 0 when the request never reached the API, which the UI reports
 * differently: a network failure is retryable, a 409 is not.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly issues: readonly ValidationIssue[];

  constructor(
    status: number,
    code: ApiErrorCode | string,
    message: string,
    issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }

  /**
   * Collapse `issues[]` into one message per field path.
   *
   * The API already reports which field failed, so a form should point at the
   * input rather than showing a single banner and making the user hunt.
   */
  fieldErrors(): Readonly<Record<string, string>> {
    const errors: Record<string, string> = {};
    for (const issue of this.issues) {
      if (!(issue.path in errors)) errors[issue.path] = issue.message;
    }
    return errors;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

/** An aborted request is a cancelled intention, never something to report. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    issues?: unknown;
  };
}

function readIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): ValidationIssue[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { path, message } = entry as Record<string, unknown>;
    if (typeof path !== 'string' || typeof message !== 'string') return [];
    return [{ path, message }];
  });
}

const FALLBACK_MESSAGES: Readonly<Record<number, string>> = {
  404: 'That resource no longer exists.',
  409: 'That change conflicts with the current state of the data.',
  500: 'The server could not complete the request.',
};

async function toApiError(response: Response): Promise<ApiRequestError> {
  const fallback =
    FALLBACK_MESSAGES[response.status] ?? `The request failed with status ${response.status}.`;

  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON body means the failure came from somewhere other than the API
    // — the dev proxy, for instance. The status is still meaningful.
    return new ApiRequestError(response.status, 'internal_error', fallback);
  }

  const code = typeof body.error?.code === 'string' ? body.error.code : 'internal_error';
  const message = typeof body.error?.message === 'string' ? body.error.message : fallback;

  return new ApiRequestError(response.status, code, message, readIssues(body.error?.issues));
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiRequestError(
      0,
      'network_error',
      'Could not reach the API. Check that the stack is running.',
    );
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * Relative paths only, so the Vite dev proxy and the container build behave
 * identically and no host name is ever compiled into the bundle.
 */
export const httpTransport: Transport = {
  get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    return send<T>(`${path}${buildQuery(params)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  },

  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return send<T>(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  },
};
