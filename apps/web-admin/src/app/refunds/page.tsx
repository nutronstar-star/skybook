'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { apiFetch, ApiClientError, formatInr, type AdminRefundRow } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';

export default function AdminRefundsPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAdminAuth();

  const [refunds, setRefunds] = useState<AdminRefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRefunds = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ data: AdminRefundRow[] }>('/v1/admin/refunds', {
        token: accessToken
      });
      setRefunds(res.data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load refunds');
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
    void loadRefunds();
  }, [isReady, accessToken, router, loadRefunds]);

  const handleApprove = async (refundId: string) => {
    const reason = window.prompt('Enter operational reason for approving refund:', 'Approved per cancellation policy');
    if (!reason || reason.trim().length < 5) return;

    if (!accessToken) return;
    setActionLoadingId(refundId);
    setError(null);
    try {
      await apiFetch(`/v1/admin/refunds/${refundId}/approve`, {
        method: 'POST',
        token: accessToken,
        headers: { 'X-Admin-Reason': reason.trim() },
        body: JSON.stringify({ reason: reason.trim() })
      });
      await loadRefunds();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Approval failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (refundId: string) => {
    const reason = window.prompt('Enter operational reason for rejecting refund:', 'Ineligible per cancellation tier');
    if (!reason || reason.trim().length < 5) return;

    if (!accessToken) return;
    setActionLoadingId(refundId);
    setError(null);
    try {
      await apiFetch(`/v1/admin/refunds/${refundId}/reject`, {
        method: 'POST',
        token: accessToken,
        headers: { 'X-Admin-Reason': reason.trim() },
        body: JSON.stringify({ reason: reason.trim() })
      });
      await loadRefunds();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Rejection failed');
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
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
          Refund Approval &amp; Gateway Queue
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Review passenger cancellation refund requests and trigger idempotency-protected Razorpay payouts.
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
                  Refund ID / PNR
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Refund Amount
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Tier / Reason
                </th>
                <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Status
                </th>
                <th className="px-6 py-4 text-right font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-hairline)' }}>
              {refunds.map((r) => {
                const statusColor =
                  r.status === 'COMPLETED'
                    ? 'var(--signal-emerald)'
                    : r.status === 'REJECTED' || r.status === 'FAILED'
                      ? 'var(--danger-crimson)'
                      : 'var(--warning-amber)';

                return (
                  <tr key={r.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-6 py-4">
                      <div className="font-mono text-xs font-bold" style={{ color: 'var(--text-brand)' }}>
                        PNR: {r.booking.pnr}
                      </div>
                      <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {r.id.slice(0, 12)}...
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-extrabold" style={{ color: 'var(--text-bright)' }}>
                      {formatInr(r.amountPaise)}
                    </td>
                    <td className="px-6 py-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div><strong>{r.refundPercentage}% tier</strong></div>
                      <div>{r.reason}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className="inline-flex rounded-full px-3 py-1 font-mono text-[10px] font-bold"
                        style={{
                          backgroundColor: `${statusColor}20`,
                          color: statusColor
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.status === 'INITIATED' && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={actionLoadingId === r.id}
                            onClick={() => void handleApprove(r.id)}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
                            style={{
                              backgroundColor: 'var(--signal-emerald-subtle)',
                              color: 'var(--signal-emerald)'
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actionLoadingId === r.id}
                            onClick={() => void handleReject(r.id)}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
                            style={{
                              backgroundColor: 'var(--danger-crimson-subtle)',
                              color: 'var(--danger-crimson)'
                            }}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      )}
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