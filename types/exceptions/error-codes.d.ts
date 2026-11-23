/**
 * Enumeration for all available error codes
 */
export enum ERROR_CODES {
  // An unexpected failure in the worklet's own code
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // The WDK is not initialized, or it failed to initialize
  WDK_MANAGER_INIT = 'WDK_MANAGER_INIT',
  // The request is missing or not valid
  BAD_REQUEST = 'BAD_REQUEST',
  // A JSON-RPC request reused the id of a request that is still running
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  // The method is not in the list of allowed methods
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  // A wallet threw: its details and causes describe the failure
  WALLET_ERROR = 'WALLET_ERROR',
  // A protocol threw: its details and causes describe the failure
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  // A module threw: its details and causes describe the failure
  MODULE_ERROR = 'MODULE_ERROR'
}

export default ERROR_CODES;
