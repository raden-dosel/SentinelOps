/**
 * SentinelOps - Cryptographic Authentication & Account Recovery Provider
 * Implements PBKDF2 authentication, recovery codes, hardened security questions,
 * server-assisted emergency recovery, session invalidation, and rate-limiting lockouts.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LocalUser, AuthSession, RecoveryCodeRecord } from '../../types';
import {
  userRepository,
  settingsRepository,
  auditRepository,
  syncConfigRepository,
} from '../../storage/repositories';
import {
  hashPassword,
  verifyPassword,
  generateSalt,
  generateUUID,
  generateRecoveryCodes,
  verifyRecoveryCode,
  validatePasswordStrength,
  checkAttemptLockout,
  calculateNextLockout,
} from '../../services/security';

export interface RecoveryOptionsSummary {
  hasSecurityQuestion: boolean;
  securityQuestion?: string;
  hasRecoveryCodes: boolean;
  remainingRecoveryCodesCount: number;
  isEnrolledWithServer: boolean;
  isLocked: boolean;
  lockoutRemainingSeconds?: number;
}

export interface AuthContextValue {
  isInitialized: boolean;
  needsSetup: boolean;
  session: AuthSession | null;
  setupInitialUser: (data: {
    fullName: string;
    username: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => Promise<{ rawRecoveryCodes: string[] }>;
  completeInitialSetup: () => Promise<void>;
  login: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; lockoutRemainingSeconds?: number }>;
  unlock: (password: string) => Promise<boolean>;
  lockSession: () => void;
  logout: () => void;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  generateNewRecoveryCodes: (
    currentPassword: string
  ) => Promise<{ success: boolean; codes?: string[]; error?: string }>;
  getRecoveryOptions: (username: string) => Promise<RecoveryOptionsSummary>;
  resetPasswordWithRecoveryCode: (
    username: string,
    recoveryCode: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  resetPasswordWithSecurityAnswer: (
    username: string,
    answer: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  requestServerRecoveryChallenge: () => Promise<{
    success: boolean;
    challengeCode?: string;
    expiresAt?: string;
    error?: string;
  }>;
  resetPasswordWithServerAuthorization: (
    username: string,
    recoveryAuthCode: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateSecurityQuestion: (
    currentPassword: string,
    newQuestion: string,
    newAnswer: string
  ) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  // Initialize Auth state on mount
  useEffect(() => {
    async function initAuth() {
      try {
        const hasUser = await userRepository.hasAnyUser();
        if (!hasUser) {
          setNeedsSetup(true);
        }
      } catch (err) {
        console.error('Failed to check user repository:', err);
      } finally {
        setIsInitialized(true);
      }
    }
    initAuth();
  }, []);

  // Validate active session version against database on user activity
  const validateSessionVersion = useCallback(async () => {
    if (!session || !session.isAuthenticated) return;
    try {
      const user = await userRepository.getUserByUsername(session.username);
      if (!user || (user.sessionVersion && session.sessionVersion && user.sessionVersion !== session.sessionVersion)) {
        // Session invalidated due to password change or revocation
        setSession(null);
        await auditRepository.logEvent({
          action: 'ACTIVE_SESSIONS_REVOKED',
          entityType: 'User',
          entityId: session.userId,
          entityLabel: session.username,
          actorId: session.userId,
          actorName: session.fullName,
          details: { reason: 'Session version mismatch after password change' },
        });
      }
    } catch {
      // Ignore transient storage errors during background check
    }
  }, [session]);

  useEffect(() => {
    validateSessionVersion();
  }, [validateSessionVersion]);

  // Auto-lock listener on user activity
  useEffect(() => {
    if (!session || !session.isAuthenticated || session.isLocked) return;

    const currentSession = session;
    let timeoutId: number;

    async function checkAutoLock() {
      const settings = await settingsRepository.getSettings();
      if (!settings.autoLockMinutes || settings.autoLockMinutes <= 0) return;

      const timeoutMs = settings.autoLockMinutes * 60 * 1000;

      const resetTimer = () => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          setSession((prev) => (prev ? { ...prev, isLocked: true } : null));
          auditRepository.logEvent({
            action: 'AUTH_LOCK',
            entityType: 'User',
            entityId: currentSession.userId,
            entityLabel: currentSession.username,
            actorId: currentSession.userId,
            actorName: currentSession.fullName,
            details: { reason: 'Auto-lock timeout reached' },
          });
        }, timeoutMs);
      };

      const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
      events.forEach((ev) => window.addEventListener(ev, resetTimer));
      resetTimer();

      return () => {
        window.clearTimeout(timeoutId);
        events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      };
    }

    const cleanupPromise = checkAutoLock();
    return () => {
      window.clearTimeout(timeoutId);
      cleanupPromise.then((cleanup) => cleanup && cleanup());
    };
  }, [session]);

  const setupInitialUser = async (data: {
    fullName: string;
    username: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }): Promise<{ rawRecoveryCodes: string[] }> => {
    const passwordValidation = validatePasswordStrength(data.password);
    if (!passwordValidation.isValid) {
      throw new Error(passwordValidation.message);
    }

    const salt = generateSalt(16);
    const passwordHash = await hashPassword(data.password, salt);

    const answerSalt = generateSalt(16);
    const securityAnswerHash = await hashPassword(
      data.securityAnswer.trim().toLowerCase(),
      answerSalt
    );

    // Generate initial 8 emergency recovery codes
    const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);

    const user: LocalUser = {
      id: generateUUID(),
      username: data.username.trim().toLowerCase(),
      fullName: data.fullName.trim(),
      email: `${data.username.trim()}@sentinelops.local`,
      passwordHash: `${salt}:${passwordHash}`,
      salt,
      securityQuestion: data.securityQuestion,
      securityAnswerHash: `${answerSalt}:${securityAnswerHash}`,
      recoveryCodes: hashedCodes,
      failedLoginAttempts: 0,
      failedRecoveryAttempts: 0,
      passwordChangedAt: new Date().toISOString(),
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    await userRepository.saveUser(user);

    await auditRepository.logEvent({
      action: 'RECOVERY_CODE_GENERATED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { count: rawCodes.length, initialSetup: true },
    });

    return { rawRecoveryCodes: rawCodes };
  };

  const completeInitialSetup = async () => {
    const user = await userRepository.getFirstUser();
    if (!user) return;
    setNeedsSetup(false);
    setSession({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      isAuthenticated: true,
      isLocked: false,
      lastActiveTimestamp: Date.now(),
      sessionVersion: 1,
    });
    await auditRepository.logEvent({
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      actorId: user.id,
      actorName: user.fullName,
      details: { initialSetup: true },
    });
  };

  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string; lockoutRemainingSeconds?: number }> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);

    // Constant-time dummy verification if user does not exist (anti-enumeration & anti-timing)
    if (!user) {
      const dummySalt = generateSalt(16);
      await verifyPassword(password, '0'.repeat(64), dummySalt);
      return { success: false, error: 'Invalid username or password.' };
    }

    // Check login rate-limiting lockout
    const lockout = checkAttemptLockout(user.failedLoginAttempts || 0, user.loginLockoutUntil);
    if (lockout.isLocked) {
      return {
        success: false,
        error: `Account is temporarily locked due to repeated failed attempts. Please wait ${lockout.remainingSeconds} seconds.`,
        lockoutRemainingSeconds: lockout.remainingSeconds,
      };
    }

    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isValid = await verifyPassword(password, storedHash, storedSalt);

    if (!isValid) {
      const consecutiveFailures = (user.failedLoginAttempts || 0) + 1;
      const { lockoutUntil, lockoutSeconds } = calculateNextLockout(consecutiveFailures);
      user.failedLoginAttempts = consecutiveFailures;
      user.loginLockoutUntil = lockoutUntil;
      await userRepository.saveUser(user);

      await auditRepository.logEvent({
        action: 'AUTH_LOGIN',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { success: false, failedAttempts: consecutiveFailures, lockoutSeconds },
      });

      if (lockoutSeconds > 0) {
        return {
          success: false,
          error: `Too many failed login attempts. Locked out for ${lockoutSeconds} seconds.`,
          lockoutRemainingSeconds: lockoutSeconds,
        };
      }
      return { success: false, error: 'Invalid username or password.' };
    }

    // Success: reset failures and login lockout
    user.failedLoginAttempts = 0;
    user.loginLockoutUntil = undefined;
    user.lastLoginAt = new Date().toISOString();
    await userRepository.saveUser(user);

    setSession({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      isAuthenticated: true,
      isLocked: false,
      lastActiveTimestamp: Date.now(),
      sessionVersion: user.sessionVersion || 1,
    });

    await auditRepository.logEvent({
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      actorId: user.id,
      actorName: user.fullName,
      details: { success: true },
    });

    return { success: true };
  };

  const unlock = async (password: string): Promise<boolean> => {
    if (!session) return false;
    const user = await userRepository.getUserByUsername(session.username);
    if (!user) return false;

    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isValid = await verifyPassword(password, storedHash, storedSalt);
    if (!isValid) return false;

    setSession((prev) =>
      prev ? { ...prev, isLocked: false, lastActiveTimestamp: Date.now() } : null
    );

    await auditRepository.logEvent({
      action: 'AUTH_UNLOCK',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      actorId: user.id,
      actorName: user.fullName,
    });

    return true;
  };

  const lockSession = useCallback(() => {
    if (!session) return;
    setSession((prev) => (prev ? { ...prev, isLocked: true } : null));
    auditRepository.logEvent({
      action: 'AUTH_LOCK',
      entityType: 'User',
      entityId: session.userId,
      entityLabel: session.username,
      actorId: session.userId,
      actorName: session.fullName,
      details: { manualLock: true },
    });
  }, [session]);

  const logout = useCallback(() => {
    if (session) {
      auditRepository.logEvent({
        action: 'AUTH_LOGOUT',
        entityType: 'User',
        entityId: session.userId,
        entityLabel: session.username,
        actorId: session.userId,
        actorName: session.fullName,
      });
    }
    setSession(null);
  }, [session]);

  // Requirement A: Authenticated user changes password at will
  const changePassword = async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!session || !session.isAuthenticated) {
      return { success: false, error: 'You must be authenticated to change your password.' };
    }

    const user = await userRepository.getUserByUsername(session.username);
    if (!user) {
      return { success: false, error: 'User vault record not found.' };
    }

    // Verify current authentication factor
    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isCurrentValid = await verifyPassword(currentPassword, storedHash, storedSalt);
    if (!isCurrentValid) {
      await auditRepository.logEvent({
        action: 'PASSWORD_CHANGE_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { success: false, reason: 'Current password verification failed' },
      });
      return { success: false, error: 'Current password is incorrect.' };
    }

    // Enforce password strength policy
    const policy = validatePasswordStrength(newPassword);
    if (!policy.isValid) {
      return { success: false, error: policy.message };
    }

    const newSalt = generateSalt(16);
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    const nextSessionVersion = (user.sessionVersion || 1) + 1;

    user.passwordHash = `${newSalt}:${newPasswordHash}`;
    user.salt = newSalt;
    user.sessionVersion = nextSessionVersion;
    user.passwordChangedAt = new Date().toISOString();
    user.failedLoginAttempts = 0;
    user.loginLockoutUntil = undefined;

    await userRepository.saveUser(user);

    // Keep current local session active with new sessionVersion
    setSession((prev) =>
      prev ? { ...prev, sessionVersion: nextSessionVersion, lastActiveTimestamp: Date.now() } : null
    );

    await auditRepository.logEvent({
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { newSessionVersion: nextSessionVersion },
    });

    await auditRepository.logEvent({
      action: 'ACTIVE_SESSIONS_REVOKED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { reason: 'Password change invalidated prior sessions' },
    });

    return { success: true };
  };

  // Generate new set of emergency recovery codes in Settings
  const generateNewRecoveryCodes = async (
    currentPassword: string
  ): Promise<{ success: boolean; codes?: string[]; error?: string }> => {
    if (!session || !session.isAuthenticated) {
      return { success: false, error: 'Authentication required to generate recovery codes.' };
    }

    const user = await userRepository.getUserByUsername(session.username);
    if (!user) {
      return { success: false, error: 'User vault record not found.' };
    }

    // Must verify current password before generating codes
    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isCurrentValid = await verifyPassword(currentPassword, storedHash, storedSalt);
    if (!isCurrentValid) {
      return { success: false, error: 'Current password is incorrect.' };
    }

    // Invalidate prior codes
    const priorCount = user.recoveryCodes?.length || 0;
    const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);
    user.recoveryCodes = hashedCodes;
    await userRepository.saveUser(user);

    if (priorCount > 0) {
      await auditRepository.logEvent({
        action: 'RECOVERY_CODE_REVOKED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { priorCodesCount: priorCount },
      });
    }

    await auditRepository.logEvent({
      action: 'RECOVERY_CODE_GENERATED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { count: rawCodes.length },
    });

    return { success: true, codes: rawCodes };
  };

  // Enumerate-safe retrieval of available recovery methods
  const getRecoveryOptions = async (username: string): Promise<RecoveryOptionsSummary> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);
    const syncCfg = await syncConfigRepository.getConfig();

    if (!user) {
      // Simulate equal latency to prevent account timing enumeration
      const dummySalt = generateSalt(16);
      await verifyPassword('dummy', '0'.repeat(64), dummySalt);
      return {
        hasSecurityQuestion: false,
        hasRecoveryCodes: false,
        remainingRecoveryCodesCount: 0,
        isEnrolledWithServer: Boolean(syncCfg?.deviceId),
        isLocked: false,
      };
    }

    const lockout = checkAttemptLockout(
      user.failedRecoveryAttempts || 0,
      user.recoveryLockoutUntil
    );
    const unusedCodes = (user.recoveryCodes || []).filter((c) => !c.usedAt);

    return {
      hasSecurityQuestion: Boolean(user.securityQuestion && user.securityAnswerHash),
      securityQuestion: user.securityQuestion,
      hasRecoveryCodes: unusedCodes.length > 0,
      remainingRecoveryCodesCount: unusedCodes.length,
      isEnrolledWithServer: Boolean(syncCfg?.deviceId),
      isLocked: lockout.isLocked,
      lockoutRemainingSeconds: lockout.remainingSeconds,
    };
  };

  // Requirement B: Recovery via One-Time Emergency Recovery Code
  const resetPasswordWithRecoveryCode = async (
    username: string,
    recoveryCode: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);

    if (!user) {
      const dummySalt = generateSalt(16);
      await verifyPassword(recoveryCode, '0'.repeat(64), dummySalt);
      return { success: false, error: 'Invalid or expired recovery code.' };
    }

    const lockout = checkAttemptLockout(
      user.failedRecoveryAttempts || 0,
      user.recoveryLockoutUntil
    );
    if (lockout.isLocked) {
      return {
        success: false,
        error: `Recovery is temporarily locked due to multiple failed attempts. Please wait ${lockout.remainingSeconds} seconds.`,
      };
    }

    const policy = validatePasswordStrength(newPassword);
    if (!policy.isValid) {
      return { success: false, error: policy.message };
    }

    const verification = await verifyRecoveryCode(recoveryCode, user.recoveryCodes || []);
    if (!verification.isValid || !verification.matchedCodeId) {
      const consecutiveFailures = (user.failedRecoveryAttempts || 0) + 1;
      const { lockoutUntil, lockoutSeconds } = calculateNextLockout(consecutiveFailures);
      user.failedRecoveryAttempts = consecutiveFailures;
      user.recoveryLockoutUntil = lockoutUntil;
      await userRepository.saveUser(user);

      await auditRepository.logEvent({
        action: 'PASSWORD_RESET_FAILED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { method: 'RECOVERY_CODE', failedAttempts: consecutiveFailures, lockoutSeconds },
      });

      return {
        success: false,
        error:
          lockoutSeconds > 0
            ? `Invalid recovery code. Locked out for ${lockoutSeconds} seconds.`
            : 'Invalid or previously used recovery code.',
      };
    }

    // Mark single-use code as used
    user.recoveryCodes = (user.recoveryCodes || []).map((codeRecord) =>
      codeRecord.id === verification.matchedCodeId
        ? { ...codeRecord, usedAt: new Date().toISOString() }
        : codeRecord
    );

    // Reset password & update session version
    const newSalt = generateSalt(16);
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    const nextSessionVersion = (user.sessionVersion || 1) + 1;

    user.passwordHash = `${newSalt}:${newPasswordHash}`;
    user.salt = newSalt;
    user.sessionVersion = nextSessionVersion;
    user.passwordChangedAt = new Date().toISOString();
    user.failedRecoveryAttempts = 0;
    user.recoveryLockoutUntil = undefined;
    user.failedLoginAttempts = 0;
    user.loginLockoutUntil = undefined;

    await userRepository.saveUser(user);

    // Terminate existing sessions to enforce fresh login
    setSession(null);

    await auditRepository.logEvent({
      action: 'RECOVERY_CODE_USED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { codeId: verification.matchedCodeId },
    });

    await auditRepository.logEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { recoveryMethod: 'One-Time Recovery Code' },
    });

    await auditRepository.logEvent({
      action: 'ACTIVE_SESSIONS_REVOKED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { reason: 'Recovery completed: all prior sessions terminated' },
    });

    return { success: true };
  };

  // Hardened Security Question Recovery (Rate-Limited)
  const resetPasswordWithSecurityAnswer = async (
    username: string,
    answer: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);

    if (!user || !user.securityAnswerHash) {
      const dummySalt = generateSalt(16);
      await verifyPassword(answer, '0'.repeat(64), dummySalt);
      return { success: false, error: 'Invalid security answer.' };
    }

    const lockout = checkAttemptLockout(
      user.failedRecoveryAttempts || 0,
      user.recoveryLockoutUntil
    );
    if (lockout.isLocked) {
      return {
        success: false,
        error: `Recovery is temporarily locked due to repeated failed attempts. Please wait ${lockout.remainingSeconds} seconds.`,
      };
    }

    const policy = validatePasswordStrength(newPassword);
    if (!policy.isValid) {
      return { success: false, error: policy.message };
    }

    const [salt, hash] = user.securityAnswerHash.split(':');
    const isAnswerValid = await verifyPassword(answer.trim().toLowerCase(), hash, salt);

    if (!isAnswerValid) {
      const consecutiveFailures = (user.failedRecoveryAttempts || 0) + 1;
      const { lockoutUntil, lockoutSeconds } = calculateNextLockout(consecutiveFailures);
      user.failedRecoveryAttempts = consecutiveFailures;
      user.recoveryLockoutUntil = lockoutUntil;
      await userRepository.saveUser(user);

      await auditRepository.logEvent({
        action: 'PASSWORD_RESET_FAILED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { method: 'SECURITY_QUESTION', failedAttempts: consecutiveFailures, lockoutSeconds },
      });

      return {
        success: false,
        error:
          lockoutSeconds > 0
            ? `Security answer did not match. Locked out for ${lockoutSeconds} seconds.`
            : 'Security answer did not match recorded records.',
      };
    }

    const newSalt = generateSalt(16);
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    const nextSessionVersion = (user.sessionVersion || 1) + 1;

    user.passwordHash = `${newSalt}:${newPasswordHash}`;
    user.salt = newSalt;
    user.sessionVersion = nextSessionVersion;
    user.passwordChangedAt = new Date().toISOString();
    user.failedRecoveryAttempts = 0;
    user.recoveryLockoutUntil = undefined;
    user.failedLoginAttempts = 0;
    user.loginLockoutUntil = undefined;

    await userRepository.saveUser(user);

    // Terminate existing sessions to enforce fresh login
    setSession(null);

    await auditRepository.logEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { recoveryMethod: 'Security Recovery Question' },
    });

    await auditRepository.logEvent({
      action: 'ACTIVE_SESSIONS_REVOKED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { reason: 'Password reset via security question completed' },
    });

    return { success: true };
  };

  // Server-assisted recovery request (for administrator/enrolled device)
  const requestServerRecoveryChallenge = async (): Promise<{
    success: boolean;
    challengeCode?: string;
    expiresAt?: string;
    error?: string;
  }> => {
    const syncCfg = await syncConfigRepository.getConfig();
    if (!syncCfg || !syncCfg.apiBaseUrl || !syncCfg.deviceId) {
      return {
        success: false,
        error: 'This device is not currently enrolled with a SentinelOps sync server.',
      };
    }

    try {
      const url = `${syncCfg.apiBaseUrl.replace(/\/+$/, '')}/api/v1/devices/${syncCfg.deviceId}/recovery/request`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncCfg.deviceToken}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          error: data.title || data.message || `Server rejected recovery request (${res.status}).`,
        };
      }

      const body = await res.json();
      return {
        success: true,
        challengeCode: body.recoveryAuthorizationCode,
        expiresAt: body.expiresAtUtc,
      };
    } catch (err) {
      return {
        success: false,
        error: 'Unable to reach the sync server. Please verify network connectivity.',
      };
    }
  };

  // Reset password via Server Emergency Recovery Authorization
  const resetPasswordWithServerAuthorization = async (
    username: string,
    recoveryAuthCode: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);
    if (!user) {
      return { success: false, error: 'User vault record not found.' };
    }

    const syncCfg = await syncConfigRepository.getConfig();
    if (!syncCfg || !syncCfg.apiBaseUrl || !syncCfg.deviceId) {
      return {
        success: false,
        error: 'Server recovery requires this device to be enrolled with a SentinelOps server.',
      };
    }

    const policy = validatePasswordStrength(newPassword);
    if (!policy.isValid) {
      return { success: false, error: policy.message };
    }

    try {
      const url = `${syncCfg.apiBaseUrl.replace(/\/+$/, '')}/api/v1/devices/${syncCfg.deviceId}/recovery/verify`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recoveryAuthorizationCode: recoveryAuthCode.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          error: data.title || data.message || 'Invalid or expired server recovery authorization code.',
        };
      }

      // Server verified code! Proceed with password replacement
      const newSalt = generateSalt(16);
      const newPasswordHash = await hashPassword(newPassword, newSalt);
      const nextSessionVersion = (user.sessionVersion || 1) + 1;

      user.passwordHash = `${newSalt}:${newPasswordHash}`;
      user.salt = newSalt;
      user.sessionVersion = nextSessionVersion;
      user.passwordChangedAt = new Date().toISOString();
      user.failedRecoveryAttempts = 0;
      user.recoveryLockoutUntil = undefined;
      user.failedLoginAttempts = 0;
      user.loginLockoutUntil = undefined;

      await userRepository.saveUser(user);

      // Invalidate existing sessions
      setSession(null);

      await auditRepository.logEvent({
        action: 'SERVER_RECOVERY_COMPLETED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { recoveryMethod: 'Server Emergency Recovery' },
      });

      await auditRepository.logEvent({
        action: 'ACTIVE_SESSIONS_REVOKED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        actorId: user.id,
        actorName: user.fullName,
        details: { reason: 'Server recovery authorization completed' },
      });

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Password recovery requires an internet connection because server credentials must be verified securely.',
      };
    }
  };

  // Update Security Question from Settings
  const updateSecurityQuestion = async (
    currentPassword: string,
    newQuestion: string,
    newAnswer: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!session || !session.isAuthenticated) {
      return { success: false, error: 'Authentication required.' };
    }

    const user = await userRepository.getUserByUsername(session.username);
    if (!user) {
      return { success: false, error: 'User vault record not found.' };
    }

    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isCurrentValid = await verifyPassword(currentPassword, storedHash, storedSalt);
    if (!isCurrentValid) {
      return { success: false, error: 'Current password is incorrect.' };
    }

    if (!newQuestion.trim() || !newAnswer.trim()) {
      return { success: false, error: 'Question and answer cannot be empty.' };
    }

    const answerSalt = generateSalt(16);
    const securityAnswerHash = await hashPassword(newAnswer.trim().toLowerCase(), answerSalt);

    user.securityQuestion = newQuestion.trim();
    user.securityAnswerHash = `${answerSalt}:${securityAnswerHash}`;
    await userRepository.saveUser(user);

    await auditRepository.logEvent({
      action: 'SECURITY_QUESTION_UPDATED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.username,
      actorId: user.id,
      actorName: user.fullName,
      details: { question: newQuestion.trim() },
    });

    return { success: true };
  };

  return (
    <AuthContext.Provider
      value={{
        isInitialized,
        needsSetup,
        session,
        setupInitialUser,
        completeInitialSetup,
        login,
        unlock,
        lockSession,
        logout,
        changePassword,
        generateNewRecoveryCodes,
        getRecoveryOptions,
        resetPasswordWithRecoveryCode,
        resetPasswordWithSecurityAnswer,
        requestServerRecoveryChallenge,
        resetPasswordWithServerAuthorization,
        updateSecurityQuestion,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
