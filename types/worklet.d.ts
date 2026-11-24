import { BareRPC } from './bare-rpc';
import { HRPC } from './hrpc/hrpc';
import { RpcContext } from './rpc';

export * from './rpc';

/**
 * Register all RPC handlers with the provided RPC instance
 */
export function registerRpcHandlers(rpc: HRPC | BareRPC, context: RpcContext): void;

export const utils: {
  crypto: typeof import('./utils/crypto');
  logger: typeof import('./utils/logger').default;
  validation: typeof import('./utils/validation');
};

export const exceptions: {
  errorCodes: typeof import('./exceptions/error-codes').default;
  rpcException: typeof import('./exceptions/rpc-exception');
};
