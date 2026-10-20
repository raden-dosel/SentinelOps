/**
 * SentinelOps - Local Authentication & Session State Management
 * Provides first-run setup, PBKDF2 login, auto-lock timeout, and session lock.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LocalUser, AuthSession } from '../../types';
import { userRepository, settingsRepository, auditRepository } from '../../storage/repositories';
import { hashPassword, verifyPassword, generateSalt, generateUUID } from '../../services/security';

interface AuthContextValue {
  isInitialized: boolean;
  needsSetup: boolean;
  session: AuthSession | null;
  setupInitialUser: (data: {
    fullName: string;
    username: string;
    password: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  unlock: (password: string) => Promise<boolean>;
  lockSession: () => void;
  logout: () => void;
  resetPasswordWithSecurityAnswer: (username: string, answer: string, newPassword: string) => Promise<boolean>;
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
  }) => {
    const salt = generateSalt(16);
    const passwordHash = await hashPassword(data.password, salt);

    const answerSalt = generateSalt(16);
    const securityAnswerHash = await hashPassword(data.securityAnswer.trim().toLowerCase(), answerSalt);

    const user: LocalUser = {
      id: generateUUID(),
      username: data.username.trim().toLowerCase(),
      fullName: data.fullName.trim(),
      email: `${data.username.trim()}@sentinelops.local`,
      passwordHash: `${salt}:${passwordHash}`,
      salt,
      securityQuestion: data.securityQuestion,
      securityAnswerHash: `${answerSalt}:${securityAnswerHash}`,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    await userRepository.saveUser(user);
    setNeedsSetup(false);

    // Auto-login after initial setup
    setSession({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      isAuthenticated: true,
      isLocked: false,
      lastActiveTimestamp: Date.now(),
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

  const login = async (username: string, password: string): Promise<boolean> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);
    if (!user) {
      return false;
    }

    const [storedSalt, storedHash] = user.passwordHash.split(':');
    const isValid = await verifyPassword(password, storedHash, storedSalt);
    if (!isValid) {
      return false;
    }

    user.lastLoginAt = new Date().toISOString();
    await userRepository.saveUser(user);

    setSession({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      isAuthenticated: true,
      isLocked: false,
      lastActiveTimestamp: Date.now(),
    });

    await auditRepository.logEvent({
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      actorId: user.id,
      actorName: user.fullName,
    });

    return true;
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

  const resetPasswordWithSecurityAnswer = async (
    username: string,
    answer: string,
    newPassword: string
  ): Promise<boolean> => {
    const cleanUsername = username.trim().toLowerCase();
    const user = await userRepository.getUserByUsername(cleanUsername);
    if (!user || !user.securityAnswerHash) return false;

    const [salt, hash] = user.securityAnswerHash.split(':');
    const isAnswerValid = await verifyPassword(answer.trim().toLowerCase(), hash, salt);
    if (!isAnswerValid) return false;

    const newSalt = generateSalt(16);
    const newPasswordHash = await hashPassword(newPassword, newSalt);
    user.passwordHash = `${newSalt}:${newPasswordHash}`;
    user.salt = newSalt;
    await userRepository.saveUser(user);

    await auditRepository.logEvent({
      action: 'SETTINGS_UPDATE',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      actorId: user.id,
      actorName: user.fullName,
      details: { passwordReset: true },
    });

    return true;
  };

  return (
    <AuthContext.Provider
      value={{
        isInitialized,
        needsSetup,
        session,
        setupInitialUser,
        login,
        unlock,
        lockSession,
        logout,
        resetPasswordWithSecurityAnswer,
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
