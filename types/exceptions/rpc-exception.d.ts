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
 * An error thrown by code the worklet calls but does not own: a wallet, a
 * protocol or a module. It pairs the thrown value, kept as its cause, with
 * the code that says which kind of call failed.
 */
export class ExternalError extends Error {
  constructor(code: ERROR_CODES, cause: unknown);

  // The code to report for the thrown value
  code: ERROR_CODES;

  // The thrown value
  cause: unknown;
}

/**
 * Call code the worklet does not own and report what it throws under a code.
 * Rejects with an ExternalError if the call throws.
 */
export function callExternal<T>(
  code: ERROR_CODES,
  call: () => T | Promise<T>
): Promise<T>;

/**
 * Create the description of an error that is sent to the host. Its code is
 * always one of the worklet's codes; a code set by a library is reported in
 * the details.
 */
export function createStructuredError(
  error: unknown,
  defaultCode?: ERROR_CODES
): StructuredError;

/**
 * Convert a thrown value to the error a handler rejects with. Its message is
 * the JSON of the structured error and it carries the code as a property.
 */
export function toRpcError(
  error: unknown,
  defaultCode?: ERROR_CODES
): Error & { code: ERROR_CODES };
