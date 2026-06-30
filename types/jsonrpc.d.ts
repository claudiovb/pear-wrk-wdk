import { RpcContext } from './rpc';

export * from './rpc';

/**
 * Register all JSON-RPC handlers with the provided BareKit IPC instance.
 *
 * Unlike the HRPC transport (which receives an HRPC instance), the JSON-RPC
 * transport is driven by a length-prefixed framed stream over the BareKit IPC.
 *
 * @param ipc - The BareKit IPC instance
 * @param context - Shared RPC context (WDK instance, managers, dependencies)
 */
export function registerJsonRpcHandlers(ipc: any, context: RpcContext): void;

export const utils: {
  crypto: typeof import('./utils/crypto');
  logger: typeof import('./utils/logger').default;
  validation: typeof import('./utils/validation');
};

export const exceptions: {
  errorCodes: typeof import('./exceptions/error-codes').default;
  rpcException: typeof import('./exceptions/rpc-exception');
};
