'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plane, Plus, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiClientError, formatInr, type AdminFlight } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';

export default function AdminFlightsPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAdminAuth();

  const [flights, setFlights] = useState<AdminFlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFlights = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ data: AdminFlight[] }>('/v1/admin/flights', {
        token: accessToken
      });
      setFlights(res.data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load flights');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isReady) return;
    if (!accessToken) {
      router.push('/login');
      return;
    }
    void loadFlights();
  }, [isReady, accessToken, router, loadFlights]);

  const handlePublish = async (flightId: string) => {
    if (!accessToken) return;
    setActionLoadingId(flightId);
    setError(null);
    try {
      await apiFetch(`/v1/admin/flights/${flightId}/publish`, {
        method: 'POST',
        token: accessToken,
        headers: { 'X-Admin-Reason': 'Publishing verified flight schedule for passenger booking' },
        body: JSON.stringify({ reason: 'Publishing verified flight schedule for passenger booking' })
      });
      await loadFlights();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Publish failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (flightId: string, flightNum: string) => {
    const reason = window.prompt(
      `Enter operational reason for cancelling flight ${flightNum} (triggers automatic 100% passenger refund cascade):`,
      'Airspace restrictions and severe weather disruption'
    );
    if (!reason || reason.trim().length < 5) return;

    if (!accessToken) return;
    setActionLoadingId(flightId);
    setError(null);
    try {
      await apiFetch(`/v1/admin/flights/${flightId}/cancel`, {
        method: 'POST',
        token: accessToken,
        headers: { 'X-Admin-Reason': reason.trim() },
        body: JSON.stringify({ reason: reason.trim() })
      });
      await loadFlights();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Cancellation failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isReady || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="h-96 animate-pulse rounded-3xl" style={{ backgroundColor: 'var(--surface-card)' }} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Flight Operations &amp; Lifecycle Studio
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Manage DRAFT, PUBLISHED, and CANCELLED flights with instant Redis search cache invalidation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => alert('Use the API or seed scripts to create new flights with aircraft layouts.')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold"
            style={{
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-inverse)'
            }}
          >
            <Plus className="h-4 w-4" />
            New Flight Schedule
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
                  Flight / Airline
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Route
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Departure (IST)
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Status
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Bookings
                </th>
                <th className="px-6 py-4 text-right font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-hairline)' }}>
              {flights.map((f) => {
                const statusColor =
                  f.status === 'PUBLISHED'
                    ? 'var(--signal-emerald)'
                    : f.status === 'CANCELLED'
                      ? 'var(--danger-crimson)'
                      : 'var(--warning-amber)';
                const statusBg =
                  f.status === 'PUBLISHED'
                    ? 'var(--signal-emerald-subtle)'
                    : f.status === 'CANCELLED'
                      ? 'var(--danger-crimson-subtle)'
                      : 'var(--warning-amber-subtle)';

                return (
                  <tr key={f.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-6 py-4">
                      <div className="font-extrabold" style={{ color: 'var(--text-bright)' }}>
                        {f.flightNumber}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {f.airlineName}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      {f.originAirport.iataCode} → {f.destinationAirport.iataCode}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(f.departureTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className="inline-flex rounded-full px-3 py-1 font-mono text-[10px] font-bold"
                        style={{ backgroundColor: statusBg, color: statusColor }}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold" style={{ color: 'var(--text-bright)' }}>
                      {f._count.bookings}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {f.status === 'DRAFT' && (
                          <button
                            type="button"
                            disabled={actionLoadingId === f.id}
                            onClick={() => void handlePublish(f.id)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                            style={{
                              backgroundColor: 'var(--brand-primary-subtle)',
                              color: 'var(--text-brand)',
                              border: '1px solid var(--brand-primary-border)'
                            }}
                          >
                            Publish
                          </button>
                        )}
                        {f.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            disabled={actionLoadingId === f.id}
                            onClick={() => void handleCancel(f.id, f.flightNumber)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                            style={{
                              backgroundColor: 'var(--danger-crimson-subtle)',
                              color: 'var(--danger-crimson)'
                            }}
                          >
                            Cancel Flight
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}