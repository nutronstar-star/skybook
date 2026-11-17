'use client';

import React, { useState } from 'react';
import { Phone, Mail, KeyRound, X, Sparkles, ArrowRight } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { SkyBookLogo } from './SkyBookLogo';

export function OtpAuthModal() {
  const { authModalOpen, closeAuthModal, completeLogin } = useAuth();
  const [channel, setChannel] = useState<'PHONE' | 'EMAIL'>('PHONE');
  const [phone, setPhone] = useState('+919876543210');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [otp, setOtp] = useState('');
  const [mockOtpHint, setMockOtpHint] = useState<string | null>(null);
  const [step, setStep] = useState<'REQUEST' | 'VERIFY'>('REQUEST');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authModalOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (channel === 'PHONE') {
        const res = await apiFetch<{ mockOtp?: string }>('/v1/auth/otp/request', {
          method: 'POST',
          body: JSON.stringify({ phone: phone.trim() })
        });
        setMockOtpHint(res.mockOtp ?? null);
        if (res.mockOtp) setOtp(res.mockOtp);
      } else {
        const res = await apiFetch<{ mockOtp?: string }>('/v1/auth/email-otp/request', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase() })
        });
        setMockOtpHint(res.mockOtp ?? null);
        if (res.mockOtp) setOtp(res.mockOtp);
      }
      setStep('VERIFY');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint =
        channel === 'PHONE' ? '/v1/auth/otp/verify' : '/v1/auth/email-otp/verify';
      const payload =
        channel === 'PHONE'
          ? {
              phone: phone.trim(),
              otp: otp.trim(),
              ...(fullName.trim().length >= 2 ? { fullName: fullName.trim() } : {})
            }
          : {
              email: email.trim().toLowerCase(),
              otp: otp.trim(),
              ...(fullName.trim().length >= 2 ? { fullName: fullName.trim() } : {})
            };

      const tokens = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; role: 'PASSENGER' | 'ADMIN' };
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setStep('REQUEST');
      setOtp('');
      setMockOtpHint(null);
      await completeLogin(tokens);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className="relative w-full max-w-md rounded-3xl p-7 transition-all"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-modal)'
        }}
      >
        <button
          type="button"
          onClick={closeAuthModal}
          className="absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            backgroundColor: 'var(--surface-hover)',
            color: 'var(--text-secondary)'
          }}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6">
          <SkyBookLogo />
          <h2 className="mt-4 text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Passenger Express Sign-In
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Passwordless 6-digit OTP verification for seat locking, checkout &amp; e-boarding passes.
          </p>
        </div>

        {/* Channel Switcher */}
        <div
          className="mb-5 grid grid-cols-2 gap-1.5 rounded-xl p-1"
          style={{
            backgroundColor: 'var(--canvas-subtle)',
            border: '1px solid var(--border-hairline)'
          }}
        >
          <button
            type="button"
            onClick={() => {
              setChannel('PHONE');
              setStep('REQUEST');
              setError(null);
            }}
            className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-all"
            style={{
              backgroundColor: channel === 'PHONE' ? 'var(--surface-card)' : 'transparent',
              color: channel === 'PHONE' ? 'var(--text-brand)' : 'var(--text-secondary)'
            }}
          >
            <Phone className="h-3.5 w-3.5" />
            Mobile OTP
          </button>
          <button
            type="button"
            onClick={() => {
              setChannel('EMAIL');
              setStep('REQUEST');
              setError(null);
            }}
            className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-all"
            style={{
              backgroundColor: channel === 'EMAIL' ? 'var(--surface-card)' : 'transparent',
              color: channel === 'EMAIL' ? 'var(--text-brand)' : 'var(--text-secondary)'
            }}
          >
            <Mail className="h-3.5 w-3.5" />
            Email OTP
          </button>
        </div>

        {error && (
          <div
            className="mb-4 rounded-xl px-4 py-2.5 text-xs font-semibold"
            style={{
              backgroundColor: 'var(--danger-crimson-subtle)',
              color: 'var(--danger-crimson)',
              border: '1px solid var(--danger-crimson)'
            }}
          >
            {error}
          </div>
        )}

        {step === 'REQUEST' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            {channel === 'PHONE' ? (
              <div>
                <label
                  className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Mobile Number (E.164)
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full rounded-xl px-4 py-3 font-mono text-sm font-semibold focus:outline-none"
                  style={{
                    backgroundColor: 'var(--canvas-subtle)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-bright)'
                  }}
                />
              </div>
            ) : (
              <div>
                <label
                  className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="traveler@skybook.in"
                  className="w-full rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none"
                  style={{
                    backgroundColor: 'var(--canvas-subtle)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-bright)'
                  }}
                />
              </div>
            )}

            <div>
              <label
                className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Full Name (Optional for new accounts)
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Sharma"
                className="w-full rounded-xl px-4 py-3 text-sm font-medium focus:outline-none"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-60"
              style={{
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-glow-primary)'
              }}
            >
              {loading ? 'Dispatching OTP...' : 'Send 6-Digit Verification Code'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {mockOtpHint && (
              <div
                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs"
                style={{
                  backgroundColor: 'var(--signal-emerald-subtle)',
                  border: '1px solid var(--signal-emerald)',
                  color: 'var(--signal-emerald)'
                }}
              >
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Sparkles className="h-3.5 w-3.5" />
                  DEV MOCK OTP: <strong className="font-mono text-sm">{mockOtpHint}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setOtp(mockOtpHint)}
                  className="rounded-md px-2 py-0.5 font-mono text-[11px] font-bold underline"
                >
                  Fill
                </button>
              </div>
            )}

            <div>
              <label
                className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Enter 6-Digit OTP
              </label>
              <div className="relative">
                <KeyRound
                  className="absolute left-3.5 top-3.5 h-4 w-4"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full rounded-xl py-3 pl-10 pr-4 font-mono text-lg font-bold tracking-[0.35em] focus:outline-none"
                  style={{
                    backgroundColor: 'var(--canvas-subtle)',
                    border: '1px solid var(--border-focus)',
                    color: 'var(--text-bright)'
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('REQUEST');
                  setError(null);
                }}
                className="rounded-xl px-4 py-3 text-xs font-bold"
                style={{
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-secondary)'
                }}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-60"
                style={{
                  backgroundColor: 'var(--brand-primary)',
                  color: 'var(--text-inverse)',
                  boxShadow: 'var(--shadow-glow-primary)'
                }}
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}