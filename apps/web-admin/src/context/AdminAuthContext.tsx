'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface AdminSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; role: 'PASSENGER' | 'ADMIN' };
}

interface AdminAuthContextValue {
  accessToken: string | null;
  isReady: boolean;
  login: (session: AdminSession) => void;
  logout: () => void;
}

const STORAGE_KEY = 'skybook_admin_session_v1';

const AdminAuthContext = createContext<AdminAuthContextValue>({
  accessToken: null,
  isReady: false,
  login: () => {},
  logout: () => {}
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AdminSession;
        setAccessToken(parsed.accessToken);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsReady(true);
  }, []);

  const login = (session: AdminSession) => {
    setAccessToken(session.accessToken);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  };

  const logout = () => {
    setAccessToken(null);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AdminAuthContext.Provider value={{ accessToken, isReady, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}