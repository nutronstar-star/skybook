'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, TrendingUp, DollarSign, RotateCcw } from 'lucide-react';
import { apiFetch, ApiClientError, formatInr, type RevenueDashboardResponse } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAdminAuth();

  const [dashboard, setDashboard] = useState<RevenueDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await apiFetch<RevenueDashboardResponse>('/v1/admin/dashboard/revenue', {
        token: accessToken
      });
      setDashboard(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load revenue dashboard');
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
    void loadDashboard();
  }, [isReady, accessToken, router, loadDashboard]);

  if (!isReady || loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="h-96 animate-pulse rounded-3xl" style={{ backgroundColor: 'var(--surface-card)' }} />
      </div>
    );
  }

  if (!dashboard) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
          Executive Revenue &amp; Financial Analytics
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Aggregated daily totals, per-flight performance, cabin class breakdown, and refund metrics.
        </p>
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

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              GROSS REVENUE
            </span>
            <DollarSign className="h-5 w-5" style={{ color: 'var(--signal-emerald)' }} />
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            {formatInr(dashboard.summary.totalRevenuePaise)}
          </div>
          <div className="mt-1 font-mono text-xs" style={{ color: 'var(--signal-emerald)' }}>
            {dashboard.summary.confirmedBookingsCount} confirmed bookings
          </div>
        </div>

        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              TOTAL REFUNDS
            </span>
            <RotateCcw className="h-5 w-5" style={{ color: 'var(--danger-crimson)' }} />
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            {formatInr(dashboard.summary.totalRefundedPaise)}
          </div>
          <div className="mt-1 font-mono text-xs" style={{ color: 'var(--danger-crimson)' }}>
            {dashboard.summary.totalRefundsCount} processed refunds
          </div>
        </div>

        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              NET REVENUE
            </span>
            <TrendingUp className="h-5 w-5" style={{ color: 'var(--telemetry-cyan)' }} />
          </div>
          <div className="mt-2 font-mono text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            {formatInr(dashboard.summary.netRevenuePaise)}
          </div>
          <div className="mt-1 font-mono text-xs" style={{ color: 'var(--telemetry-cyan)' }}>
            Post-refund net earnings
          </div>
        </div>

        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
              CABIN MIX
            </span>
            <BarChart3 className="h-5 w-5" style={{ color: 'var(--text-brand)' }} />
          </div>
          <div className="mt-2 font-mono text-sm font-extrabold" style={{ color: 'var(--text-bright)' }}>
            {dashboard.byCabinClass.map((c) => `${c.cabinClass}: ${c.bookings}`).join(' · ')}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* By Flight Performance */}
        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Top Revenue Flights
          </h2>
          <div className="mt-4 space-y-3">
            {dashboard.byFlight.map((f) => (
              <div
                key={f.flightId}
                className="flex items-center justify-between rounded-2xl p-4 font-mono text-xs"
                style={{ backgroundColor: 'var(--canvas-subtle)' }}
              >
                <div>
                  <div className="font-bold" style={{ color: 'var(--text-bright)' }}>
                    {f.flightNumber} ({f.route})
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>{f.bookings} bookings</div>
                </div>
                <div className="text-sm font-extrabold" style={{ color: 'var(--text-brand)' }}>
                  {formatInr(f.revenuePaise)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Daily Revenue Trend */}
        <div
          className="rounded-3xl p-6"
          style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
        >
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Daily Revenue Trend
          </h2>
          <div className="mt-4 space-y-3">
            {dashboard.daily.map((d) => (
              <div
                key={d.date}
                className="flex items-center justify-between rounded-2xl p-4 font-mono text-xs"
                style={{ backgroundColor: 'var(--canvas-subtle)' }}
              >
                <div>
                  <div className="font-bold" style={{ color: 'var(--text-bright)' }}>{d.date}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{d.bookings} bookings</div>
                </div>
                <div className="text-sm font-extrabold" style={{ color: 'var(--signal-emerald)' }}>
                  {formatInr(d.revenuePaise)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}