import type { ZodError } from 'zod';

/**
 * The error envelope from docs/api/openapi.yaml, in one place so no route can
 * invent a different shape.
 */

export type ErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'customer_not_found'
  | 'product_not_found'
  | 'product_inactive'
  | 'internal_error';

export interface ValidationIssueBody {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly issues?: ValidationIssueBody[];

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    issues?: ValidationIssueBody[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (issues) this.issues = issues;
  }

  static validation(issues: ValidationIssueBody[], message = 'Request validation failed.'): ApiError {
    return new ApiError(400, 'validation_failed', message, issues);
  }

  /** Turn a Zod failure into the documented `issues` array. */
  static fromZod(error: ZodError): ApiError {
    return ApiError.validation(
      error.issues.map((issue) => ({
        path: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    );
  }

  static notFound(code: Extract<ErrorCode, `${string}not_found`>, message: string): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(code: Extract<ErrorCode, 'conflict' | 'product_inactive'>, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  /** Render the response body exactly as the contract documents it. */
  toBody(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.issues) error.issues = this.issues;
    return { error };
  }
}

/** PostgreSQL error codes this API interprets rather than treating as a 500. */
const UNIQUE_VIOLATION = '23505';

interface PostgresError {
  code?: string;
  constraint?: string;
}

/**
 * Map a unique-constraint violation onto the documented 409.
 *
 * Preferred over checking for an existing row first: a check-then-insert pair
 * has a race window where two concurrent requests both see nothing and both
 * insert. Letting the database arbitrate and translating its verdict cannot
 * race.
 */
export function conflictFromUniqueViolation(
  error: unknown,
  constraints: Record<string, string>,
): ApiError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const { code, constraint } = error as PostgresError;
  if (code !== UNIQUE_VIOLATION || !constraint) return undefined;

  const message = constraints[constraint];
  if (!message) return undefined;

  return ApiError.conflict('conflict', message);
}
