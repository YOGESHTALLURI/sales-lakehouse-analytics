import { isApiRequestError } from '../api/http';

export interface ErrorDescription {
  readonly title: string;
  readonly message: string;
  /** Whether offering "Try again" makes sense, or the request will just fail again. */
  readonly retryable: boolean;
}

/**
 * Turn an unknown thrown value into something worth showing a user.
 *
 * The contract states `error.message` is safe to display, so it is preferred over
 * any invented copy. A network failure is separated from an API failure because
 * only one of them is worth retrying.
 */
export function describeError(error: unknown): ErrorDescription {
  if (isApiRequestError(error)) {
    if (error.isOffline) {
      return {
        title: 'Cannot reach the API',
        message: error.message,
        retryable: true,
      };
    }

    return {
      title: error.status >= 500 ? 'The server could not respond' : 'That request was rejected',
      message: error.message,
      retryable: error.status >= 500,
    };
  }

  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    retryable: true,
  };
}
