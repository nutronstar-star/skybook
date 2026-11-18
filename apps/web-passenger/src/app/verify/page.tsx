'use client';

import React, { useEffect, useState } from 'react';
import { QrCameraScanner } from '@/components/QrCameraScanner';
import { ShieldCheck, CheckCircle2, AlertTriangle, Key } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface VerifyResult {
  valid: boolean;
  ticketId?: string;
  pnr?: string;
  reason?: string;
  payload?: {
    seatLabel: string;
    passengerName: string;
    issuedAt: string;
  };
}

export default function GateQrVerifierPage() {
  const [qrToken, setQrToken] = useState('');
  const [publicKey, setPublicKey] = useState<string>('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void apiFetch<{ publicKey: string }>('/v1/tickets/public-key')
      .then((res) => setPublicKey(res.publicKey))
      .catch(() => {});
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrToken.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch<VerifyResult>('/v1/tickets/verify', {
        method: 'POST',
        body: JSON.stringify({ qrToken: qrToken.trim() })
      });
      setResult(res);
    } catch {
      setResult({ valid: false, reason: 'NETWORK_OR_MALFORMED_TOKEN' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <div
          className="mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-bold"
          style={{
            backgroundColor: 'var(--brand-primary-subtle)',
            color: 'var(--text-brand)'
          }}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          ED25519 CRYPTOGRAPHIC GATE INSPECTOR
        </div>
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
          Verify E-Boarding Pass QR Token
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Validates the Ed25519 asymmetric signature and checks live booking cancellation status.
        </p>
      </div>

      {publicKey && (
        <div
          className="mb-6 rounded-2xl p-4"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
            <Key className="h-3.5 w-3.5" style={{ color: 'var(--telemetry-cyan)' }} />
            ACTIVE ED25519 SPKI PUBLIC KEY (OFFLINE VERIFICATION)
          </div>
          <div
            className="mt-1.5 break-all font-mono text-xs"
            style={{ color: 'var(--text-brand)' }}
          >
            {publicKey}
          </div>
        </div>
      )}

      <form
        onSubmit={handleVerify}
        className="rounded-3xl p-6"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-ambient)'
        }}
      >
        <label
          className="mb-2 block font-mono text-[11px] font-bold uppercase"
          style={{ color: 'var(--text-muted)' }}
        >
          Paste Signed QR Payload (`v1:...`)
        </label>
        <QrCameraScanner onScan={(decoded) => setQrToken(decoded)} />
          <textarea
          rows={4}
          required
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="v1:eyJib29raW5nSWQiOi..."
          className="w-full rounded-2xl p-4 font-mono text-xs focus:outline-none"
          style={{
            backgroundColor: 'var(--canvas-subtle)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-bright)'
          }}
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-4 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-extrabold"
          style={{
            backgroundColor: 'var(--brand-primary)',
            color: 'var(--text-inverse)',
            boxShadow: 'var(--shadow-glow-primary)'
          }}
        >
          <ShieldCheck className="h-4 w-4" />
          {loading ? 'Verifying Signature...' : 'Verify Boarding Pass'}
        </button>
      </form>

      {result && (
        <div
          className="mt-6 rounded-3xl p-6"
          style={{
            backgroundColor: result.valid
              ? 'var(--signal-emerald-subtle)'
              : 'var(--danger-crimson-subtle)',
            border: `1px solid ${result.valid ? 'var(--signal-emerald)' : 'var(--danger-crimson)'}`
          }}
        >
          <div className="flex items-center gap-3">
            {result.valid ? (
              <CheckCircle2 className="h-6 w-6" style={{ color: 'var(--signal-emerald)' }} />
            ) : (
              <AlertTriangle className="h-6 w-6" style={{ color: 'var(--danger-crimson)' }} />
            )}
            <div>
              <div
                className="text-base font-extrabold"
                style={{
                  color: result.valid ? 'var(--signal-emerald)' : 'var(--danger-crimson)'
                }}
              >
                {result.valid
                  ? 'VALID E-BOARDING PASS · CLEARED FOR BOARDING'
                  : `REJECTED · ${result.reason ?? 'INVALID_SIGNATURE'}`}
              </div>
              {result.valid && result.payload && (
                <div className="mt-1 font-mono text-xs" style={{ color: 'var(--text-bright)' }}>
                  Passenger: {result.payload.passengerName} · Seat: {result.payload.seatLabel} ·
                  PNR: {result.pnr}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}