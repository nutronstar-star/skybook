'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Eye, FileSpreadsheet, X, Lock } from 'lucide-react';
import { API_BASE_URL, apiFetch, ApiClientError, formatInr, type MaskedBookingRow } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';

export default function AdminBookingsPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAdminAuth();

  const [bookings, setBookings] = useState<MaskedBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pnrFilter, setPnrFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Unmask Modal state
  const [unmaskModalBookingId, setUnmaskModalBookingId] = useState<string | null>(null);
  const [unmaskReason, setUnmaskReason] = useState('Security verification and passenger manifest check');
  const [unmasking, setUnmasking] = useState(false);
  const [unmaskedData, setUnmaskedData] = useState<any | null>(null);

  const loadBookings = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (pnrFilter.trim()) qs.set('pnr', pnrFilter.trim().toUpperCase());

      const res = await apiFetch<{ data: MaskedBookingRow[] }>(`/v1/admin/bookings?${qs.toString()}`, {
        token: accessToken
      });
      setBookings(res.data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to fetch bookings');
    } finally {
      setLoading(false);
    }
  }, [accessToken, pnrFilter]);

  useEffect(() => {
    if (!isReady) return;
    if (!accessToken) {
      router.push('/login');
      return;
    }
    void loadBookings();
  }, [isReady, accessToken, router, loadBookings]);

  const handleExecuteUnmask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !unmaskModalBookingId || unmaskReason.trim().length < 5) return;

    setUnmasking(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/bookings/${unmaskModalBookingId}/unmask`, {
        method: 'POST',
        token: accessToken,
        headers: { 'X-Admin-Reason': unmaskReason.trim() },
        body: JSON.stringify({ reason: unmaskReason.trim() })
      });
      setUnmaskedData(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unmask failed');
    } finally {
      setUnmasking(false);
    }
  };

  const handleExportCsv = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/bookings/export.csv`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skybook-masked-bookings.csv';
      a.click();
    } catch {
      alert('CSV export failed');
    }
  };

  if (!isReady) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Booking Oversight &amp; Audited PII Unmasking
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Passenger phone, email, and government ID numbers are masked by default per privacy regulations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={pnrFilter}
            onChange={(e) => setPnrFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadBookings();
            }}
            placeholder="Filter by PNR..."
            className="rounded-xl px-4 py-2.5 font-mono text-xs uppercase focus:outline-none"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-bright)'
            }}
          />
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-bright)'
            }}
          >
            <FileSpreadsheet className="h-4 w-4" style={{ color: 'var(--signal-emerald)' }} />
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mb-6 rounded-2xl px-4 py-3 text-xs font-bold"
          style={{
            backgroundColor: 'var(--danger-crimson-subtle)',
            border: '1px solid var(--danger-crimson)',
            color: 'var(--danger-crimson)'
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-96 animate-pulse rounded-3xl" style={{ backgroundColor: 'var(--surface-card)' }} />
      ) : (
        <div
          className="overflow-hidden rounded-3xl"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-ambient)'
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--canvas-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    PNR / Flight
                  </th>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Status / Cabin
                  </th>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Masked Contact
                  </th>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Masked Passengers
                  </th>
                  <th className="px-6 py-4 text-right font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    PII Audit Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-hairline)' }}>
                {bookings.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm font-extrabold" style={{ color: 'var(--text-brand)' }}>
                        {b.pnr}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {b.flight.flightNumber} · {b.flight.route}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-bright)' }}>
                        {b.status}
                      </span>
                      <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {b.cabinClass} · {formatInr(b.totalAmountPaise)}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div>{b.accountContactMasked.phone ?? 'No Phone'}</div>
                      <div>{b.accountContactMasked.email ?? 'No Email'}</div>
                    </td>
                    <td className="px-6 py-4 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {b.passengers.map((p) => (
                        <div key={p.id}>
                          <strong>{p.fullNameMasked}</strong> (Seat {p.seatNumber}) · {p.govtIdType}: {p.govtIdMasked}
                        </div>
                      ))}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setUnmaskModalBookingId(b.id);
                          setUnmaskedData(null);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all"
                        style={{
                          backgroundColor: 'var(--brand-primary-subtle)',
                          color: 'var(--text-brand)',
                          border: '1px solid var(--brand-primary-border)'
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Unmask PII
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audited Unmask Modal */}
      {unmaskModalBookingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-lg rounded-3xl p-7"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-modal)'
            }}
          >
            <button
              type="button"
              onClick={() => setUnmaskModalBookingId(null)}
              className="absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-secondary)' }}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase" style={{ color: 'var(--danger-crimson)' }}>
              <ShieldAlert className="h-4 w-4" />
              AUDITED PII UNMASKING PROTOCOL (FR-ADM-012)
            </div>
            <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Mandatory Audit Reason Required
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Accessing unmasked government ID documents and personal contact data is permanently recorded in the immutable audit ledger.
            </p>

            {!unmaskedData ? (
              <form onSubmit={handleExecuteUnmask} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                    Justification / Ticket Reference
                  </label>
                  <textarea
                    rows={3}
                    required
                    minLength={5}
                    value={unmaskReason}
                    onChange={(e) => setUnmaskReason(e.target.value)}
                    className="w-full rounded-xl p-3 text-xs font-medium focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={unmasking}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-extrabold"
                  style={{
                    backgroundColor: 'var(--danger-crimson)',
                    color: '#FFFFFF'
                  }}
                >
                  <Lock className="h-4 w-4" />
                  {unmasking ? 'Logging Audit & Decrypting...' : 'Log Audit & Reveal Unmasked PII'}
                </button>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <div
                  className="rounded-2xl p-4 font-mono text-xs space-y-2"
                  style={{ backgroundColor: 'var(--canvas-subtle)', color: 'var(--text-bright)' }}
                >
                  <div className="font-extrabold text-sm" style={{ color: 'var(--signal-emerald)' }}>
                    ✓ AUDIT LOG RECORDED · UNMASKED SUCCESSFULLY
                  </div>
                  <div><strong>Account Holder:</strong> {unmaskedData.accountHolder.fullName} ({unmaskedData.accountHolder.email})</div>
                  <div><strong>Phone:</strong> {unmaskedData.accountHolder.phone ?? 'N/A'}</div>
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <strong>Passengers:</strong>
                    {unmaskedData.passengers.map((p: any) => (
                      <div key={p.id} className="mt-1">
                        {p.fullName} (Seat {p.seatNumber}) · Age: {p.age} · {p.govtIdType}: <strong>{p.govtIdNumber}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setUnmaskModalBookingId(null)}
                  className="w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-bright)' }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}