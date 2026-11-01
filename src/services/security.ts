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

// Unambiguous character set for recovery codes (32 characters, no 0/O or 1/I/L)
const RECOVERY_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Normalize recovery code string (removes whitespace, dashes, REC- prefix, converts uppercase)
 */
export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/^REC-?/i, '')
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
}

/**
 * Format raw 8-character normalized code into readable REC-XXXX-XXXX display
 */
export function formatRecoveryCode(normalizedCode: string): string {
  const clean = normalizeRecoveryCode(normalizedCode);
  if (clean.length < 8) return clean;
  return `REC-${clean.substring(0, 4)}-${clean.substring(4, 8)}`;
}

/**
 * Validate password strength policy
 * Policy: Min 8 characters, at least one letter, and at least one number or symbol
 */
export function validatePasswordStrength(password: string): { isValid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one letter.' };
  }
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one number or special symbol.' };
  }
  return { isValid: true };
}

/**
 * Check if an operation is currently locked out due to prior failed attempts
 */
export function checkAttemptLockout(
  failedAttempts = 0,
  lockoutUntil?: string
): { isLocked: boolean; remainingSeconds?: number } {
  if (!lockoutUntil) return { isLocked: false };
  const lockoutTime = new Date(lockoutUntil).getTime();
  const now = Date.now();
  if (now < lockoutTime) {
    const remainingSeconds = Math.ceil((lockoutTime - now) / 1000);
    return { isLocked: true, remainingSeconds };
  }
  return { isLocked: false };
}

/**
 * Calculate progressive lockout delay based on number of consecutive failures
 */
export function calculateNextLockout(consecutiveFailures: number): {
  lockoutUntil?: string;
  lockoutSeconds: number;
} {
  let lockoutSeconds = 0;
  if (consecutiveFailures >= 7) {
    lockoutSeconds = 900; // 15 minutes
  } else if (consecutiveFailures >= 5) {
    lockoutSeconds = 300; // 5 minutes
  } else if (consecutiveFailures >= 3) {
    lockoutSeconds = 60; // 1 minute
  }

  if (lockoutSeconds > 0) {
    const lockoutUntil = new Date(Date.now() + lockoutSeconds * 1000).toISOString();
    return { lockoutUntil, lockoutSeconds };
  }
  return { lockoutSeconds: 0 };
}

/**
 * Generate a set of cryptographically random, single-use emergency recovery codes.
 * Returns displayable formatted strings for the user and salted PBKDF2 hashes for storage.
 */
export async function generateRecoveryCodes(count = 8): Promise<{
  rawCodes: string[];
  hashedCodes: { id: string; codeHash: string; salt: string; createdAt: string }[];
}> {
  const rawCodes: string[] = [];
  const hashedCodes: { id: string; codeHash: string; salt: string; createdAt: string }[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    // 8 characters from 32-char high-entropy set
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += RECOVERY_CHARSET[randomBytes[j] % RECOVERY_CHARSET.length];
    }

    const formattedCode = formatRecoveryCode(code);
    const normalized = normalizeRecoveryCode(code);

    const salt = generateSalt(16);
    const codeHash = await hashPassword(normalized, salt);

    rawCodes.push(formattedCode);
    hashedCodes.push({
      id: generateUUID(),
      codeHash,
      salt,
      createdAt: now,
    });
  }

  return { rawCodes, hashedCodes };
}

/**
 * Verify a submitted recovery code against a list of unused hashed recovery codes.
 */
export async function verifyRecoveryCode(
  attempt: string,
  records: { id: string; codeHash: string; salt: string; usedAt?: string }[]
): Promise<{ isValid: boolean; matchedCodeId?: string }> {
  const normalizedAttempt = normalizeRecoveryCode(attempt);
  if (normalizedAttempt.length !== 8) {
    return { isValid: false };
  }

  const unusedRecords = records.filter((r) => !r.usedAt);
  for (const record of unusedRecords) {
    const isMatch = await verifyPassword(normalizedAttempt, record.codeHash, record.salt);
    if (isMatch) {
      return { isValid: true, matchedCodeId: record.id };
    }
  }

  return { isValid: false };
}
