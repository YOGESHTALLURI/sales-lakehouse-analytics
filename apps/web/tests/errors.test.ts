import { describe, expect, it } from 'vitest';
import { ApiRequestError, buildQuery } from '../src/api/http';
import { describeError } from '../src/lib/describeError';

describe('buildQuery', () => {
  it('omits unset filters instead of sending empty values', () => {
    expect(buildQuery({ limit: 50, offset: 0, category: undefined })).toBe('?limit=50&offset=0');
  });

  it('serialises booleans the way the contract expects', () => {
    expect(buildQuery({ active: true })).toBe('?active=true');
  });

  it('produces nothing at all when there is nothing to send', () => {
    expect(buildQuery({ from: undefined })).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('ApiRequestError.fieldErrors', () => {
  it('maps issues onto their field paths', () => {
    const error = new ApiRequestError(400, 'validation_failed', 'Request validation failed.', [
      { path: 'email', message: 'Enter a valid email address.' },
      { path: 'items.1.quantity', message: 'Expected an integer greater than 0' },
    ]);

    expect(error.fieldErrors()).toEqual({
      email: 'Enter a valid email address.',
      'items.1.quantity': 'Expected an integer greater than 0',
    });
  });

  it('keeps the first message when a field fails twice', () => {
    const error = new ApiRequestError(400, 'validation_failed', 'Request validation failed.', [
      { path: 'sku', message: 'This field is required.' },
      { path: 'sku', message: 'Must be 40 characters or fewer.' },
    ]);

    expect(error.fieldErrors().sku).toBe('This field is required.');
  });

  it('has no field errors for a conflict, which names no field', () => {
    const error = new ApiRequestError(409, 'conflict', 'A customer with that email already exists.');
    expect(error.fieldErrors()).toEqual({});
  });
});

describe('describeError', () => {
  it('shows the API message, which the contract says is safe to display', () => {
    const error = new ApiRequestError(409, 'conflict', 'A product with that SKU already exists.');

    expect(describeError(error).message).toBe('A product with that SKU already exists.');
  });

  it('offers a retry for a server failure but not for a rejected request', () => {
    expect(describeError(new ApiRequestError(500, 'internal_error', 'Boom')).retryable).toBe(true);
    expect(describeError(new ApiRequestError(409, 'conflict', 'Taken')).retryable).toBe(false);
  });

  it('distinguishes an unreachable API from one that answered', () => {
    const offline = new ApiRequestError(0, 'network_error', 'Could not reach the API.');

    expect(offline.isOffline).toBe(true);
    expect(describeError(offline).title).toBe('Cannot reach the API');
  });

  it('survives a thrown value that is not an Error', () => {
    expect(describeError('something odd').message).toBe('An unexpected error occurred.');
  });
});
