'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Sun, Ticket, ShieldCheck, LogOut, UserCheck, Compass } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { SkyBookLogo } from './SkyBookLogo';

export function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, openAuthModal, logout } = useAuth();

  const navItems = [
    { href: '/', label: 'Book Flights', icon: Compass },
    { href: '/trips', label: 'My Trips & Passes', icon: Ticket },
    { href: '/verify', label: 'Gate QR Verifier', icon: ShieldCheck }
  ];

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
          <Link href="/" className="focus:outline-none">
            <SkyBookLogo />
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

        {/* Right HUD: Dual-Theme Engine + Passenger Session */}
        <div className="flex items-center gap-3">
          {/* Dual-Theme Pill Switcher (brand.html Top Control HUD) */}
          <div
            className="flex items-center gap-1 rounded-full p-1"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)'
            }}
            role="group"
            aria-label="Theme Engine"
          >
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all"
              style={{
                backgroundColor: theme === 'dark' ? 'var(--brand-primary)' : 'transparent',
                color: theme === 'dark' ? 'var(--text-inverse)' : 'var(--text-secondary)'
              }}
            >
              <Moon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Dark</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all"
              style={{
                backgroundColor: theme === 'light' ? 'var(--brand-primary)' : 'transparent',
                color: theme === 'light' ? 'var(--text-inverse)' : 'var(--text-secondary)'
              }}
            >
              <Sun className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Light</span>
            </button>
          </div>

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/trips"
                className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                style={{
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              >
                <UserCheck className="h-3.5 w-3.5" style={{ color: 'var(--signal-emerald)' }} />
                <span className="font-mono">
                  {user.fullName || user.phone || user.email || 'Traveler'}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                title="Sign out"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                style={{
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal()}
              className="rounded-full px-4 py-2 text-xs font-bold tracking-wide transition-all"
              style={{
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-glow-primary)'
              }}
            >
              Sign In / OTP
            </button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Bar */}
      <div
        className="flex md:hidden items-center justify-around px-2 py-2"
        style={{ borderTop: '1px solid var(--border-hairline)' }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                color: active ? 'var(--text-brand)' : 'var(--text-secondary)',
                backgroundColor: active ? 'var(--brand-primary-subtle)' : 'transparent'
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}