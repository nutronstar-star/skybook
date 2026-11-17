'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plane, BarChart3, ShieldAlert, RotateCcw, Moon, Sun, LogOut } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAdminAuth } from '@/context/AdminAuthContext';

export function AdminNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { accessToken, logout } = useAdminAuth();

  if (!accessToken || pathname === '/login') return null;

  const navItems = [
    { href: '/', label: 'Flight Operations', icon: Plane },
    { href: '/bookings', label: 'Booking Oversight & PII', icon: ShieldAlert },
    { href: '/refunds', label: 'Refund Approvals', icon: RotateCcw },
    { href: '/dashboard', label: 'Revenue Analytics', icon: BarChart3 }
  ];

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md transition-colors"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--canvas-bg) 86%, transparent)',
        borderBottom: '1px solid var(--border-subtle)'
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-extrabold uppercase tracking-widest" style={{ color: 'var(--telemetry-cyan)' }}>
              SKYBOOK // ADMIN CONSOLE
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: active ? 'var(--brand-primary-subtle)' : 'transparent',
                    color: active ? 'var(--text-brand)' : 'var(--text-secondary)',
                    border: active
                      ? '1px solid var(--brand-primary-border)'
                      : '1px solid transparent'
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 rounded-full p-1"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: theme === 'dark' ? 'var(--brand-primary)' : 'transparent',
                color: theme === 'dark' ? 'var(--text-inverse)' : 'var(--text-secondary)'
              }}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: theme === 'light' ? 'var(--brand-primary)' : 'transparent',
                color: theme === 'light' ? 'var(--text-inverse)' : 'var(--text-secondary)'
              }}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--danger-crimson)'
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}