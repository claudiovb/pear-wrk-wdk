import type {
  LogRequest,
  WorkletStartRequest,
  WorkletStartResponse,
  DisposeRequest,
  CallMethodRequest,
  CallMethodResponse,
  CallModuleRequest,
  CallModuleResponse,
  ModuleEventRequest,
  WdkInitializeParams,
  WdkGenerateEntropyParams,
  WdkEntropyResult,
  WdkGetMnemonicParams,
  WdkResetWalletParams,
} from '../rpc';

/**
 * Stream interface for RPC communication
 */
export interface RPCStream {
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Request stream interface for RPC communication
 */
export interface RPCRequestStream {
  [key: string]: unknown;
}

/**
 * HRPC class for handling RPC communication with the worklet
 */
export class HRPC {
  constructor(stream: unknown);

  /**
   * Send a log message
   */
  log(args: LogRequest): void;

  /**
   * @deprecated
   * Start the worklet
   */
  workletStart(args: WorkletStartRequest): Promise<WorkletStartResponse>;

  /**
   * Initialize WDK
   */
  initializeWDK(args: WdkInitializeParams): Promise<{ status: string }>;
  
  resetWdkWallets(args: WdkResetWalletParams): Promise<{ status: string }>;

  /**
   * Generate entropy and encrypt it
   */
  generateEntropyAndEncrypt(args: WdkGenerateEntropyParams): Promise<WdkEntropyResult>;

  /**
   * Get mnemonic from encrypted entropy
   */
  getMnemonicFromEntropy(args: WdkGetMnemonicParams): Promise<{ mnemonic: string }>;

  /**
   * Get encrypted seed and entropy from mnemonic
   */
  getSeedAndEntropyFromMnemonic(args: { mnemonic: string }): Promise<WdkEntropyResult>;

  /**
   * Dispose of the worklet
   */
  dispose(args: DisposeRequest): void;

  /**
   * Call a method on a wallet account
   */
  callMethod(args: CallMethodRequest): Promise<CallMethodResponse>;
  
  /**
   * Register a new wallet dynamically
   */
  registerWallet(args: { config: string }): Promise<{ status: string, blockchains: string }>;

  /**
   * Register a new protocol dynamically
   */
  registerProtocol(args: { config: string }): Promise<{ status: string }>;

  /**
   * Call a method on a bundled module
   */
  callModule(args: CallModuleRequest): Promise<CallModuleResponse>;

  /**
   * Send a module event to the host
   */
  moduleEvent(args: ModuleEventRequest): void;

  /**
   * Register a handler for log messages
   */
  onLog(responseFn: (request: LogRequest) => Promise<void>): void;

  /**
   * Register a handler for worklet start
   */
  onWorkletStart(
    responseFn: (request: WorkletStartRequest) => Promise<WorkletStartResponse>
  ): void;

  /**
   * Register a handler for WDK initialization
   */
  onInitializeWDK(
    responseFn: (request: WdkInitializeParams) => Promise<{ status: string }>
  ): void;

  /**
   * Register a handler for entropy generation
   */
  onGenerateEntropyAndEncrypt(
    responseFn: (request: WdkGenerateEntropyParams) => Promise<WdkEntropyResult>
  ): void;

  /**
   * Register a handler for getting mnemonic
   */
  onGetMnemonicFromEntropy(
    responseFn: (request: WdkGetMnemonicParams) => Promise<{ mnemonic: string }>
  ): void;

  /**
   * Register a handler for getting seed/entropy from mnemonic
   */
  onGetSeedAndEntropyFromMnemonic(
    responseFn: (request: { mnemonic: string }) => Promise<WdkEntropyResult>
  ): void;

  /**
   * Register a handler for dispose
   */
  onDispose(responseFn: (request: DisposeRequest) => Promise<void>): void;

  /**
   * Register a handler for call method
   */
  onCallMethod(
    responseFn: (request: CallMethodRequest) => Promise<CallMethodResponse>
  ): void;
  
  /**
   * Register a handler for wallet registration
   */
  onRegisterWallet(
    responseFn: (request: { config: string }) => Promise<{ status: string, blockchains: string }>
  ): void;

  /**
   * Register a handler for protocol registration
   */
  onRegisterProtocol(
    responseFn: (request: { config: string }) => Promise<{ status: string }>
  ): void;
  
  /**
   * Register a handler for WDK initialization
   */
  onResetWdkWallets(
    responseFn: (request: WdkResetWalletParams) => Promise<{ status: string }>
  ): void;

  /**
   * Register a handler for module calls
   */
  onCallModule(
    responseFn: (request: CallModuleRequest) => Promise<CallModuleResponse>
  ): void;

  /**
   * Register a handler for module events
   */
  onModuleEvent(
    responseFn: (request: ModuleEventRequest) => Promise<void>
  ): void;
}

export default HRPC;