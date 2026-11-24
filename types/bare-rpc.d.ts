import { HRPC } from './hrpc/hrpc';

export interface BareRPCOptions {
  // The largest frame accepted from the peer, in bytes. The session fails when a
  // larger one arrives. Defaults to BareRPC.DEFAULT_MAX_FRAME_SIZE.
  maxFrameSize?: number;

  // The most bytes a stream of the session may buffer. Defaults to
  // BareRPC.DEFAULT_MAX_BUFFERED_BYTES.
  maxBufferedBytes?: number;
}

/**
 * BareRPC has the methods of HRPC, with the same requests and responses: one
 * to send each command and one to register its handler. They are declared
 * once, on HRPC, and taken from there.
 */
export interface BareRPC extends HRPC {}

/**
 * The same commands as HRPC, sent over bare-rpc with JSON payloads. A payload
 * is the request or the response as JSON, with its buffer fields as base64
 * strings; both sides of this class give and receive them as Buffers.
 */
export class BareRPC {
  // 16 MiB
  static readonly DEFAULT_MAX_FRAME_SIZE: number;

  // 16 MiB
  static readonly DEFAULT_MAX_BUFFERED_BYTES: number;

  constructor(stream: unknown, options?: BareRPCOptions);
}

export default BareRPC;
