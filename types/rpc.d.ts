export enum LogType {
  INFO = 1,
  ERROR = 2,
  DEBUG = 3,
}

export interface LogRequest {
  type?: LogType;
  data?: string | null;
}

/** @deprecated */
export interface WorkletStartRequest {
  enableDebugLogs?: number;
  seedPhrase?: string | null;
  seedBuffer?: string | null;
  config: string; // JSON string of network configurations
}

export interface WorkletStartResponse {
  status?: string | null;
}

export interface DisposeRequest {
  // Optional list of blockchains to dispose. Omit to dispose the entire WDK instance.
  blockchains?: string[];
}

export interface RpcContext {
  // WDK instance (can be null)
  wdk: any;

  // WDK class constructor
  WDK: new (...args: any[]) => any;

  // Wallet managers map
  walletManagers: Record<string, unknown>;

  // Protocol managers map
  protocolManagers: Record<string, unknown>;

  // WDK load error (if any)
  wdkLoadError: any;
}

export interface CallMethodRequest {
  // The method name to call on the account (e.g., 'getAddress', 'getBalance')
  methodName: string;

  // Network name (e.g., 'ethereum', 'spark')
  network: string;

  // Account index
  accountIndex: number;

  // JSON string of arguments to pass to the method
  args?: string;

  // JSON string of CallMethodOptions
  options?: string;
}

export interface CallMethodResponse {
  result?: string | null; // JSON string of method result
}

export interface CallMethodOptions {
  // Optional function to transform the result
  transformResult: Function;

  // Default value to return if method doesn't exist
  defaultValue: any;

  // Protocol type (e.g., 'swap', 'bridge', 'lending', 'fiat')
  protocolType: ProtocolType;

  // Protocol name (e.g., 'USDT0')
  protocolName: string;
}

export interface WdkInitializeParams {
  encryptionKey?: string;
  encryptedSeed?: string;
  
  // JSON string of WdkWorkletConfig
  config: string; 
}

export interface WdkResetWalletParams {
  // JSON string of WdkWorkletConfig
  config: string
}

export interface WdkGenerateEntropyParams {
  wordCount: 12 | 24;
}

export interface WdkEntropyResult {
  encryptionKey: string;
  encryptedSeedBuffer: string;
  encryptedEntropyBuffer: string;
}

export interface WdkGetMnemonicParams {
  encryptedEntropy: string;
  encryptionKey: string;
}

export enum ProtocolType {
  SWAP = "swap",
  BRIDGE = "bridge",
  LENDING = "lending",
  FIAT = "fiat",
}

/**
 * Network configuration map
 * Keys are network names (e.g., 'ethereum', 'spark')
 * Values are network-specific configuration objects
 */
export interface NetworkConfig {
  blockchain: string;
  config: unknown;
}

export interface ProtocolConfig {
  blockchain: string;
  protocolName: string;
  config: unknown;
}

/**
 * Worklet configuration object
 * 
 * Example:
 * {
 *   networks: {
 *     ethereum: {
 *       blockchain: 'ethereum',
 *       config: { ... }
 *     },
 *     bitcoin: {
 *       blockchain: 'bitcoin',
 *       config: { ... }
 *     }
 *   },
 *   protocols: {
 *     aaveLending: {
 *       protocolName: 'aaveLending',
 *       blockchain: 'ethereum',
 *       config: { ... }
 *     },
 *     uniswap: {
 *       protocolName: 'uniswap',
 *       blockchain: 'polygon',
 *       config: { ... }
 *     }
 *   }
 * }
 */
export interface WdkWorkletConfig {
  networks: {
    [blockchain: string]: NetworkConfig
  };
  protocols?: {
    [protocolName: string]: ProtocolConfig
  };
}
