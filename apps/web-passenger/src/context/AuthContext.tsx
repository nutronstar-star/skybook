'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface PassengerUser {
  id: string;
  role: 'PASSENGER' | 'ADMIN';
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: PassengerUser;
}

interface AuthContextValue {
  user: PassengerUser | null;
  accessToken: string | null;
  isReady: boolean;
  authModalOpen: boolean;
  openAuthModal: (onAuthenticated?: (token: string) => void) => void;
  closeAuthModal: () => void;
  completeLogin: (session: StoredSession) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const STORAGE_KEY = 'skybook_pax_session_v1';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  accessToken: null,
  isReady: false,
  authModalOpen: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  completeLogin: async () => {},
  logout: async () => {},
  refreshProfile: async () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingCallback, setPendingCallback] = useState<((token: string) => void) | null>(null);

  const hydrateProfile = useCallback(async (current: StoredSession) => {
    try {
      const profile = await apiFetch<{
        userId: string;
        fullName: string | null;
        phone: string | null;
        email: string | null;
      }>('/v1/users/me', { token: current.accessToken });

      const enriched: StoredSession = {
        ...current,
        user: {
          ...current.user,
          fullName: profile.fullName,
          phone: profile.phone,
          email: profile.email
        }
      };
      setSession(enriched);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(enriched));
    } catch {
      // Try refresh token rotation once
      try {
        const rotated = await apiFetch<{
          accessToken: string;
          refreshToken: string;
          user: { id: string; role: 'PASSENGER' | 'ADMIN' };
        }>('/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: current.refreshToken })
        });
        const nextSession: StoredSession = {
          accessToken: rotated.accessToken,
          refreshToken: rotated.refreshToken,
          user: rotated.user
        };
        setSession(nextSession);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      } catch {
        setSession(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setIsReady(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      setSession(parsed);
      void hydrateProfile(parsed).finally(() => setIsReady(true));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setIsReady(true);
    }
  }, [hydrateProfile]);

  const openAuthModal = useCallback((onAuthenticated?: (token: string) => void) => {
    setPendingCallback(() => onAuthenticated ?? null);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setPendingCallback(null);
  }, []);

  const completeLogin = useCallback(
    async (nextSession: StoredSession) => {
      setSession(nextSession);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      setAuthModalOpen(false);
      await hydrateProfile(nextSession);
      if (pendingCallback) {
        const cb = pendingCallback;
        setPendingCallback(null);
        cb(nextSession.accessToken);
      }
    },
    [hydrateProfile, pendingCallback]
  );

  const logout = useCallback(async () => {
    if (session?.accessToken) {
      try {
        await apiFetch('/v1/auth/logout', {
          method: 'POST',
          token: session.accessToken
        });
      } catch {
        // Ignore network errors on logout
      }
    }
    setSession(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  const refreshProfile = useCallback(async () => {
    if (session) {
      await hydrateProfile(session);
    }
  }, [session, hydrateProfile]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        accessToken: session?.accessToken ?? null,
        isReady,
        authModalOpen,
        openAuthModal,
        closeAuthModal,
        completeLogin,
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}