import { BareRPCOptions } from './bare-rpc';

export { HRPC } from './hrpc/hrpc';
export * from './rpc';

/**
 * What bare-stow asks a provider to generate.
 */
export interface GenerateContext {
  // The side to generate for: the host or the bundle.
  role: 'client' | 'server';

  // The options of the language.
  options: { module?: 'esm' | 'cjs' };
}

/**
 * An RPC library, as bare-stow takes one in its `server` option.
 */
export interface ServerProvider {
  // The name of the provider.
  name: string;

  // The languages it generates for. A worklet is always JavaScript.
  languages: {
    javascript: {
      /**
       * Generate the module that attaches the transport to the IPC of the worklet.
       * @throws {Error} If asked for the client role.
       */
      generate(context: GenerateContext): { source: string };
    };
  };
}

/**
 * Create the bare-stow server provider of a transport, to give to bare-stow
 * as its `server` option when the bundle is packed. The worklet then serves
 * that transport, and the entry made by createStart (./worklet) receives an
 * instance of its class. The limits are for 'bare-rpc' only: HRPC has none.
 */
export function createServerProvider(transport: 'bare-rpc', options?: BareRPCOptions): ServerProvider;
export function createServerProvider(transport: 'hrpc'): ServerProvider;
