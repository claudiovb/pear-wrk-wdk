/**
 * Securely zero out sensitive memory (memzero)
 * @param buffer - Buffer to zero out
 */
export function memzero(buffer: Buffer | Uint8Array | ArrayBuffer): void;

/**
 * Generate a strong encryption key (32 bytes for AES-256)
 * @returns Encryption key. Caller is responsible for zeroing it once no
 *   longer needed.
 */
export function generateEncryptionKey(): Buffer;

/**
 * Encrypt data using AES-256-GCM
 * @param data - Data to encrypt. Not zeroed by this function unless an
 *   internal copy had to be made (Uint8Array input) — if a Buffer is
 *   passed directly, it is left untouched and the caller is responsible
 *   for zeroing it once no longer needed.
 * @param key - Encryption key. Not zeroed — caller owns it and may need
 *   to reuse it across multiple encrypt() calls.
 * @returns IV + encrypted data + auth tag, concatenated. Caller is
 *   responsible for zeroing it once no longer needed.
 */
export function encrypt(data: Uint8Array | Buffer, key: Buffer): Buffer;

/**
 * Decrypt data using AES-256-GCM
 * @param encryptedBuffer - IV + encrypted data + auth tag, concatenated.
 *   Not zeroed by this function — it arrives as the caller's own Buffer,
 *   so the caller is responsible for zeroing it once no longer needed.
 * @param key - Encryption key. Not zeroed — caller owns it.
 * @returns Decrypted data. Caller is responsible for zeroing it once no
 *   longer needed.
 */
export function decrypt(encryptedBuffer: Buffer, key: Buffer): Buffer;

/**
 * Generate entropy for a seed phrase
 * @param wordCount - Number of words (12 or 24)
 * @returns Entropy bytes
 */
export function generateEntropy(wordCount: 12 | 24): Uint8Array;

/**
 * Encrypt seed and entropy with a new encryption key
 * @param seed - Seed bytes to encrypt. Not zeroed by this function unless
 *   an internal copy had to be made (Uint8Array input) — if a Buffer is
 *   passed directly, it is left untouched and the caller is responsible
 *   for zeroing it once no longer needed.
 * @param entropy - Entropy bytes to encrypt. Same caller-ownership rule
 *   as seed.
 * @returns Object containing encryptionKey, encryptedSeedBuffer, and
 *   encryptedEntropyBuffer — all Buffers. Caller is responsible for
 *   zeroing them once no longer needed.
 */
export function encryptSecrets(seed: Uint8Array | Buffer, entropy: Uint8Array | Buffer): {
    encryptionKey: Buffer;
    encryptedSeedBuffer: Buffer;
    encryptedEntropyBuffer: Buffer;
};
