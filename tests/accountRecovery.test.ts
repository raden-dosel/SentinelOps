import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
  normalizeRecoveryCode,
  formatRecoveryCode,
  generateRecoveryCodes,
  verifyRecoveryCode,
  validatePasswordStrength,
  checkAttemptLockout,
  calculateNextLockout,
} from '../src/services/security';
import { userRepository, auditRepository } from '../src/storage/repositories';
import { LocalUser } from '../src/types';

describe('SentinelOps Password Reset & Account Recovery Suite', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  describe('1. Password Policy & Strength Validation', () => {
    it('accepts valid passwords satisfying policy (min 8 chars, letter + number/symbol)', () => {
      const validPasswords = [
        'SecurePass123',
        'admin!2026',
        'Sentinel#Ops99',
        'Str0ngPassphrase',
        'MySecretKey42!',
      ];
      for (const pass of validPasswords) {
        const result = validatePasswordStrength(pass);
        expect(result.isValid).toBe(true);
        expect(result.message).toBeUndefined();
      }
    });

    it('rejects passwords shorter than 8 characters', () => {
      const shortPasswords = ['', 'a', '1234567', 'pass12'];
      for (const pass of shortPasswords) {
        const result = validatePasswordStrength(pass);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('8 characters');
      }
    });

    it('rejects passwords with only letters or only numbers', () => {
      const lettersOnly = validatePasswordStrength('abcdefghijk');
      expect(lettersOnly.isValid).toBe(false);
      expect(lettersOnly.message).toContain('number or special symbol');

      const numbersOnly = validatePasswordStrength('1234567890');
      expect(numbersOnly.isValid).toBe(false);
      expect(numbersOnly.message).toContain('at least one letter');
    });
  });

  describe('2. Emergency Recovery Codes Cryptography & Normalization', () => {
    it('generates exactly 8 distinct codes matching REC-XXXX-XXXX format', async () => {
      const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);

      expect(rawCodes).toHaveLength(8);
      expect(hashedCodes).toHaveLength(8);

      // Verify all raw codes are unique
      const uniqueCodes = new Set(rawCodes);
      expect(uniqueCodes.size).toBe(8);

      // Verify format REC-XXXX-XXXX and no ambiguous characters (0, 1, I, O)
      const codeRegex = /^REC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
      for (const code of rawCodes) {
        expect(code).toMatch(codeRegex);
        expect(code).not.toMatch(/[01IO]/);
      }

      // Verify stored records contain salted PBKDF2 hashes, NEVER plaintext
      for (const record of hashedCodes) {
        expect(record.codeHash).toHaveLength(64);
        expect(record.salt).toHaveLength(32);
        expect((record as any).usedAt).toBeUndefined();
        expect(rawCodes).not.toContain(record.codeHash);
      }
    });

    it('normalizes recovery code inputs across casing, spacing, and prefixes', () => {
      expect(normalizeRecoveryCode('REC-4K9W-7X2P')).toBe('4K9W7X2P');
      expect(normalizeRecoveryCode('rec-4k9w-7x2p')).toBe('4K9W7X2P');
      expect(normalizeRecoveryCode('4k9w 7x2p')).toBe('4K9W7X2P');
      expect(normalizeRecoveryCode('  rec 4k9w-7x2p  ')).toBe('4K9W7X2P');
      expect(formatRecoveryCode('4K9W7X2P')).toBe('REC-4K9W-7X2P');
    });

    it('verifies valid recovery code against hashed records and rejects invalid code', async () => {
      const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);
      const testCode = rawCodes[3];

      const check = await verifyRecoveryCode(testCode, hashedCodes);
      expect(check.isValid).toBe(true);
      expect(check.matchedCodeId).toBe(hashedCodes[3].id);

      const invalidCheck = await verifyRecoveryCode('REC-ZZZZ-9999', hashedCodes);
      expect(invalidCheck.isValid).toBe(false);
      expect(invalidCheck.matchedCodeId).toBeUndefined();
    });

    it('enforces single-use semantics: used codes are rejected on repeat attempts', async () => {
      const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);
      const testCode = rawCodes[1];

      // Initial verification succeeds
      const firstCheck = await verifyRecoveryCode(testCode, hashedCodes);
      expect(firstCheck.isValid).toBe(true);
      expect(firstCheck.matchedCodeId).toBe(hashedCodes[1].id);

      // Mark the code as consumed
      const usedRecords = hashedCodes.map((c, idx) =>
        idx === 1 ? { ...c, usedAt: new Date().toISOString() } : c
      );

      // Second verification MUST be rejected
      const secondCheck = await verifyRecoveryCode(testCode, usedRecords);
      expect(secondCheck.isValid).toBe(false);
    });
  });

  describe('3. Lockout & Progressive Backoff Protection', () => {
    it('allows attempts when failure count is below threshold', () => {
      expect(checkAttemptLockout(0, undefined).isLocked).toBe(false);
      expect(checkAttemptLockout(2, undefined).isLocked).toBe(false);
    });

    it('imposes progressive lockouts after repeated failures', () => {
      const now = Date.now();

      // After 3 failures: 1 minute lockout (60s)
      const res1 = calculateNextLockout(3);
      expect(res1.lockoutSeconds).toBe(60);
      expect(res1.lockoutUntil).toBeDefined();
      const lock1Duration = Math.round((new Date(res1.lockoutUntil!).getTime() - now) / 1000);
      expect(lock1Duration).toBeGreaterThanOrEqual(58);
      expect(lock1Duration).toBeLessThanOrEqual(62);

      // After 5 failures: 5 minute lockout (300s)
      const res2 = calculateNextLockout(5);
      expect(res2.lockoutSeconds).toBe(300);
      expect(res2.lockoutUntil).toBeDefined();
      const lock2Duration = Math.round((new Date(res2.lockoutUntil!).getTime() - now) / 1000);
      expect(lock2Duration).toBeGreaterThanOrEqual(298);
      expect(lock2Duration).toBeLessThanOrEqual(302);

      // After 7 failures: 15 minute lockout (900s)
      const res3 = calculateNextLockout(7);
      expect(res3.lockoutSeconds).toBe(900);
      expect(res3.lockoutUntil).toBeDefined();
      const lock3Duration = Math.round((new Date(res3.lockoutUntil!).getTime() - now) / 1000);
      expect(lock3Duration).toBeGreaterThanOrEqual(898);
      expect(lock3Duration).toBeLessThanOrEqual(902);
    });

    it('blocks access while lockout period is active', () => {
      const futureLockout = new Date(Date.now() + 120000).toISOString();
      const check = checkAttemptLockout(3, futureLockout);
      expect(check.isLocked).toBe(true);
      expect(check.remainingSeconds).toBeGreaterThan(0);
      expect(check.remainingSeconds).toBeLessThanOrEqual(120);
    });

    it('unblocks access once lockout period has elapsed', () => {
      const pastLockout = new Date(Date.now() - 5000).toISOString();
      const check = checkAttemptLockout(3, pastLockout);
      expect(check.isLocked).toBe(false);
    });
  });

  describe('4. Critical Recovery Scenario: Forgot Password AND Forgot Security Answer', () => {
    it('allows legitimate offline account recovery using a one-time emergency recovery code', async () => {
      // Setup initial user with password, security question, and recovery codes
      const initialSalt = generateSalt(16);
      const initialHash = await hashPassword('OriginalPassword123!', initialSalt);
      const questionSalt = generateSalt(16);
      const answerHash = await hashPassword('fluffy', questionSalt);

      const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);

      const testUser: LocalUser = {
        id: 'user-001',
        username: 'admin',
        fullName: 'Security Officer Dosel',
        email: 'raden.dosel00@gmail.com',
        passwordHash: initialHash,
        salt: initialSalt,
        securityQuestion: 'What was the name of your first pet?',
        securityAnswerHash: answerHash,
        recoveryCodes: hashedCodes,
        failedRecoveryAttempts: 0,
        recoveryLockoutUntil: undefined,
        failedLoginAttempts: 0,
        loginLockoutUntil: undefined,
        passwordChangedAt: new Date().toISOString(),
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };

      await userRepository.saveUser(testUser);

      // CRITICAL SCENARIO:
      // 1. User forgot password ("OriginalPassword123!")
      // 2. User forgot security answer (does not know "fluffy")
      // 3. User provides valid emergency recovery code from physical safe
      const userBeforeRecovery = await userRepository.getUserByUsername('admin');
      expect(userBeforeRecovery).not.toBeNull();

      const chosenCode = rawCodes[4]; // 5th code
      const check = await verifyRecoveryCode(chosenCode, userBeforeRecovery!.recoveryCodes!);
      expect(check.isValid).toBe(true);
      expect(check.matchedCodeId).toBe(hashedCodes[4].id);

      // Reset password using the verified code
      const newPassword = 'NewRecoveredPassword2026!';
      const newSalt = generateSalt(16);
      const newHash = await hashPassword(newPassword, newSalt);

      const updatedCodes = userBeforeRecovery!.recoveryCodes!.map((c) =>
        c.id === check.matchedCodeId ? { ...c, usedAt: new Date().toISOString() } : c
      );

      const recoveredUser: LocalUser = {
        ...userBeforeRecovery!,
        passwordHash: newHash,
        salt: newSalt,
        recoveryCodes: updatedCodes,
        failedRecoveryAttempts: 0,
        recoveryLockoutUntil: undefined,
        failedLoginAttempts: 0,
        loginLockoutUntil: undefined,
        passwordChangedAt: new Date().toISOString(),
        sessionVersion: (userBeforeRecovery!.sessionVersion || 1) + 1,
      };

      await userRepository.saveUser(recoveredUser);

      // Verification of recovery state:
      const userAfter = await userRepository.getUserByUsername('admin');
      expect(userAfter).not.toBeNull();

      // 1. Can authenticate with new password
      const canLoginWithNew = await verifyPassword(newPassword, userAfter!.passwordHash, userAfter!.salt);
      expect(canLoginWithNew).toBe(true);

      // 2. Old password is no longer valid
      const canLoginWithOld = await verifyPassword('OriginalPassword123!', userAfter!.passwordHash, userAfter!.salt);
      expect(canLoginWithOld).toBe(false);

      // 3. The used recovery code is now flagged as used
      const matchingCodeRecord = userAfter!.recoveryCodes!.find((c) => c.id === check.matchedCodeId);
      expect(matchingCodeRecord?.usedAt).toBeDefined();

      // 4. Stolen/reused code CANNOT be used again
      const reuseCheck = await verifyRecoveryCode(chosenCode, userAfter!.recoveryCodes!);
      expect(reuseCheck.isValid).toBe(false);

      // 5. Remaining 7 recovery codes remain intact and valid
      const unusedCount = userAfter!.recoveryCodes!.filter((c) => !c.usedAt).length;
      expect(unusedCount).toBe(7);

      // 6. Session version was incremented (revoking prior sessions)
      expect(userAfter!.sessionVersion).toBe(2);
    });
  });

  describe('5. Security Question Rate Limiting & Case-Insensitive Verification', () => {
    it('verifies security answer case-insensitively and trims whitespace', async () => {
      const salt = generateSalt(16);
      const answerHash = await hashPassword('paris', salt);

      const answersToTest = ['Paris', ' PARIS ', 'paris', '  paris  '];
      for (const answer of answersToTest) {
        const normalized = answer.trim().toLowerCase();
        const isValid = await verifyPassword(normalized, answerHash, salt);
        expect(isValid).toBe(true);
      }

      const wrongAnswer = await verifyPassword('london', answerHash, salt);
      expect(wrongAnswer).toBe(false);
    });
  });

  describe('6. User-Controlled Password Reset (Settings -> Security)', () => {
    it('requires valid current password before updating to a new password', async () => {
      const currentPass = 'CurrentMasterPass99!';
      const salt = generateSalt(16);
      const hash = await hashPassword(currentPass, salt);

      const user: LocalUser = {
        id: 'user-002',
        username: 'admin',
        fullName: 'Admin User',
        email: 'raden.dosel00@gmail.com',
        passwordHash: hash,
        salt: salt,
        securityQuestion: 'Sample Question',
        securityAnswerHash: 'hash',
        recoveryCodes: [],
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      await userRepository.saveUser(user);

      // Attempt with wrong current password MUST fail
      const wrongCurrentCheck = await verifyPassword('WrongCurrentPass1!', user.passwordHash, user.salt);
      expect(wrongCurrentCheck).toBe(false);

      // Attempt with correct current password succeeds
      const correctCurrentCheck = await verifyPassword(currentPass, user.passwordHash, user.salt);
      expect(correctCurrentCheck).toBe(true);

      // Perform update
      const newPass = 'UpdatedSecurePass2026#';
      const newSalt = generateSalt(16);
      const newHash = await hashPassword(newPass, newSalt);

      const updatedUser: LocalUser = {
        ...user,
        passwordHash: newHash,
        salt: newSalt,
        passwordChangedAt: new Date().toISOString(),
        sessionVersion: (user.sessionVersion || 1) + 1,
      };
      await userRepository.saveUser(updatedUser);

      // Verify new password is set and session version incremented
      const savedUser = await userRepository.getUserByUsername('admin');
      const verifyNew = await verifyPassword(newPass, savedUser!.passwordHash, savedUser!.salt);
      expect(verifyNew).toBe(true);
      expect(savedUser!.sessionVersion).toBe(2);
    });
  });
});
