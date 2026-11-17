'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAdminAuth();
  const [email, setEmail] = useState('admin@skybook.in');
  const [password, setPassword] = useState('SkyBook@Admin2026!#');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; role: 'PASSENGER' | 'ADMIN' };
      }>('/v1/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password })
      });
      login(res);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Invalid admin credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-4">
      <div
        className="w-full rounded-3xl p-8"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-modal)'
        }}
      >
        <div className="mb-6 text-center">
          <div className="font-mono text-xs font-extrabold uppercase tracking-widest" style={{ color: 'var(--telemetry-cyan)' }}>
            RESTRICTED ACCESS
          </div>
          <h1 className="mt-2 text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Admin Operations Console
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Argon2id secure sign-in for airline dispatchers and compliance officers.
          </p>
        </div>

        {error && (
          <div
            className="mb-4 rounded-xl px-4 py-3 text-xs font-semibold"
            style={{
              backgroundColor: 'var(--danger-crimson-subtle)',
              border: '1px solid var(--danger-crimson)',
              color: 'var(--danger-crimson)'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              Operator Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3.5 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm font-bold focus:outline-none"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              Argon2id Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm font-bold focus:outline-none"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold transition-all disabled:opacity-60"
            style={{
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-inverse)',
              boxShadow: 'var(--shadow-glow-primary)'
            }}
          >
            {loading ? 'Authenticating...' : 'Sign In to Operations Console'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}