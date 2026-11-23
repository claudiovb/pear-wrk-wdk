import { ERROR_CODES } from './error-codes';

/**
 * The simple properties copied from one error.
 */
export type ErrorDetails = Record<string, string | number | boolean>;

export interface ErrorDescription {
  // The error's name (e.g., 'TransactionError')
  name: string;

  // The error's message
  message: string;

  // The error's simple properties. Left out when there is none.
  details?: ErrorDetails;
}

/**
 * The description of an error that is sent to the host, as the JSON of the
 * message of the error a call rejects with.
 */
export interface StructuredError extends ErrorDescription {
  // The error code
  code: ERROR_CODES;

  // The errors under the thrown one, outermost first. Left out when there is none.
  causes?: ErrorDescription[];
}

/**
 * Create the description of an error that is sent to the host
 */
export function createStructuredError(
  error: unknown,
  code?: ERROR_CODES
): StructuredError;

/**
 * Convert a thrown value to the error a handler rejects with. Its message is
 * the JSON of the structured error and it carries the code as a property.
 */
export function toRpcError(
  error: unknown,
  code?: ERROR_CODES
): Error & { code: ERROR_CODES };
