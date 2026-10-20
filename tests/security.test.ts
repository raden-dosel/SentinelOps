import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  generateUUID,
  hashPassword,
  verifyPassword,
} from '../src/services/security';

describe('Local Cryptographic Security', () => {
  it('generates unique salts of requested length', () => {
    const salt1 = generateSalt(16);
    const salt2 = generateSalt(16);

    expect(salt1).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(salt2).toHaveLength(32);
    expect(salt1).not.toBe(salt2);
  });

  it('generates valid UUID v4 format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('correctly hashes password with PBKDF2 and verifies valid attempt', async () => {
    const password = 'SuperSecureLocalPassword123!';
    const salt = generateSalt(16);

    const hash = await hashPassword(password, salt);
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // 256 bits = 64 hex chars

    // Valid check
    const isValid = await verifyPassword(password, hash, salt);
    expect(isValid).toBe(true);

    // Wrong password check
    const isWrongValid = await verifyPassword('WrongPassword', hash, salt);
    expect(isWrongValid).toBe(false);
  });
});
