import BareRPC = require('./bare-rpc');
import { HRPC } from './hrpc/hrpc';
import { RpcContext } from './rpc';

export * from './rpc';

/**
 * Register all RPC handlers with the provided RPC instance
 */
export function registerRpcHandlers(rpc: HRPC | BareRPC, context: RpcContext): void;

/**
 * What bare-stow gives the entry of a bundle packed with a server provider.
 * It also passes `ipc`, the stream under the transport, which is not used.
 */
export interface StartArguments {
  // The transport, as the server provider attached it to the IPC of the worklet.
  rpc: HRPC | BareRPC;
}

/**
 * Stops the worklet: disposes the WDK instance, zeroes the seed and closes the
 * modules. It rejects if the WDK instance fails to dispose; the instance is
 * discarded and the seed is zeroed all the same.
 */
export type Stop = () => Promise<void>;

/**
 * Starts the worklet: registers the handlers of every command on the transport.
 */
export type Start = (args: StartArguments) => Stop;

/**
 * Create the entry of a worklet packed with bare-stow, to export from the
 * entry file of the bundle. bare-stow calls it when the worklet starts and
 * calls the function it returns before the worklet exits.
 */
export function createStart(context: RpcContext): Start;

export const utils: {
  crypto: typeof import('./utils/crypto');
  logger: typeof import('./utils/logger').default;
  validation: typeof import('./utils/validation');
};

export const exceptions: {
  errorCodes: typeof import('./exceptions/error-codes').default;
  rpcException: typeof import('./exceptions/rpc-exception');
};
