/**
 * SentinelOps - Cryptographic Security Service
 * Implements password hashing and data encryption using standard Web Crypto API.
 */

// Generate cryptographically secure random UUID v4
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Convert ArrayBuffer to Hex string
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert Hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Generate random salt in hex
export function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

/**
 * Hash password using PBKDF2 with SHA-256 (100,000 iterations)
 */
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const saltBytes = hexToBytes(saltHex);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  );

  return bufferToHex(derivedBits);
}

/**
 * Verify a plain password against a stored PBKDF2 hash & salt
 */
export async function verifyPassword(
  attempt: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  try {
    const computedHash = await hashPassword(attempt, storedSalt);
    // Constant-time comparison
    if (computedHash.length !== storedHash.length) return false;
    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return result === 0;
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}

/**
 * Encrypt a plaintext string using AES-GCM (256-bit key derived from password & salt)
 */
export async function encryptPayload(plaintext: string, secretKey: string, saltHex: string): Promise<{ iv: string; ciphertext: string }> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBytes = hexToBytes(saltHex);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoder.encode(plaintext)
  );

  return {
    iv: bufferToHex(iv.buffer),
    ciphertext: bufferToHex(encryptedBuffer),
  };
}

/**
 * Decrypt an AES-GCM encrypted payload
 */
export async function decryptPayload(
  ciphertextHex: string,
  ivHex: string,
  secretKey: string,
  saltHex: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBytes = hexToBytes(saltHex);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const iv = hexToBytes(ivHex);
  const ciphertextBytes = hexToBytes(ciphertextHex);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    ciphertextBytes as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
