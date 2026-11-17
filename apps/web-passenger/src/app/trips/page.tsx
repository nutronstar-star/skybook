'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plane,
  QrCode,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Compass,
  X
} from 'lucide-react';
import {
  apiFetch,
  ApiClientError,
  formatInr,
  formatIstDate,
  formatIstTime,
  type BookingTicketsResponse,
  type PassengerBookingSummary,
  type RefundPreviewResponse
} from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { BoardingPassModal } from '@/components/BoardingPassModal';

export default function MyTripsPage() {
  const { accessToken, isReady, openAuthModal } = useAuth();
  const [bookings, setBookings] = useState<PassengerBookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Boarding Pass Modal state
  const [activePassData, setActivePassData] = useState<BookingTicketsResponse | null>(null);
  const [loadingTicketId, setLoadingTicketId] = useState<string | null>(null);

  // Refund Preview & Cancellation Modal state
  const [refundPreview, setRefundPreview] = useState<RefundPreviewResponse | null>(null);
  const [cancelReason, setCancelReason] = useState('Change in travel schedule');
  const [cancelling, setCancelling] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ data: PassengerBookingSummary[] }>('/v1/bookings', {
        token: accessToken
      });
      setBookings(res.data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to fetch trips');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (isReady) {
      void loadBookings();
    }
  }, [isReady, loadBookings]);

  const handleOpenBoardingPass = async (bookingId: string) => {
    if (!accessToken) return;
    setLoadingTicketId(bookingId);
    setError(null);
    try {
      const ticketBundle = await apiFetch<BookingTicketsResponse>(
        `/v1/tickets/${bookingId}`,
        { token: accessToken }
      );
      setActivePassData(ticketBundle);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load boarding pass');
    } finally {
      setLoadingTicketId(null);
    }
  };

  const handleOpenRefundPreview = async (bookingId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      const preview = await apiFetch<RefundPreviewResponse>(
        `/v1/bookings/${bookingId}/refund-preview`,
        { token: accessToken }
      );
      setRefundPreview(preview);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to calculate refund');
    }
  };

  const handleConfirmCancellation = async () => {
    if (!accessToken || !refundPreview) return;
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/v1/bookings/${refundPreview.bookingId}/cancel`, {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ reason: cancelReason })
      });
      setRefundPreview(null);
      await loadBookings();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Cancellation failed');
    } finally {
      setCancelling(false);
    }
  };

  if (isReady && !accessToken) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div
          className="rounded-3xl p-8"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <QrCode className="mx-auto h-10 w-10" style={{ color: 'var(--text-brand)' }} />
          <h1 className="mt-4 text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Sign In to View Trips &amp; Boarding Passes
          </h1>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Access your confirmed PNRs, Ed25519 signed QR boarding passes, and instant refund
            calculator.
          </p>
          <button
            type="button"
            onClick={() => openAuthModal()}
            className="mt-6 rounded-xl px-6 py-3 text-xs font-extrabold"
            style={{
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-inverse)'
            }}
          >
            Sign In with OTP
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            My Trips &amp; Cryptographic Boarding Passes
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Manage confirmed itineraries, launch Gate Optical Boost QR passes, or preview
            time-tiered refunds.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold"
          style={{
            backgroundColor: 'var(--brand-primary)',
            color: 'var(--text-inverse)'
          }}
        >
          <Compass className="h-4 w-4" />
          Book New Flight
        </Link>
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
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-36 animate-pulse rounded-3xl"
              style={{ backgroundColor: 'var(--surface-card)' }}
            />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div
          className="rounded-3xl p-12 text-center"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <Plane className="mx-auto h-10 w-10" style={{ color: 'var(--text-muted)' }} />
          <h2 className="mt-4 text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
            No Trips Found Yet
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Search a domestic route and lock your seat to generate an Ed25519 QR boarding pass.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {bookings.map((b) => {
            const statusColor =
              b.status === 'CONFIRMED'
                ? 'var(--signal-emerald)'
                : b.status === 'CANCELLED'
                  ? 'var(--danger-crimson)'
                  : 'var(--warning-amber)';
            const statusBg =
              b.status === 'CONFIRMED'
                ? 'var(--signal-emerald-subtle)'
                : b.status === 'CANCELLED'
                  ? 'var(--danger-crimson-subtle)'
                  : 'var(--warning-amber-subtle)';

            return (
              <div
                key={b.id}
                className="rounded-3xl p-6"
                style={{
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-ambient)'
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4" style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                  <div className="flex items-center gap-3">
                    <span
                      className="rounded-lg px-2.5 py-1 font-mono text-xs font-extrabold tracking-wider"
                      style={{
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--text-brand)'
                      }}
                    >
                      PNR: {b.pnr}
                    </span>
                    <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {b.flight.airlineName} · {b.flight.flightNumber}
                    </span>
                  </div>

                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-bold"
                    style={{ backgroundColor: statusBg, color: statusColor }}
                  >
                    {b.status === 'CONFIRMED' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    {b.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-center">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="font-mono text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
                        {b.flight.origin.iataCode}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatIstTime(b.flight.departureTime)} IST
                      </div>
                    </div>

                    <Plane className="h-5 w-5" style={{ color: 'var(--brand-primary)' }} />

                    <div>
                      <div className="font-mono text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
                        {b.flight.destination.iataCode}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatIstDate(b.flight.departureTime)}
                      </div>
                    </div>

                    <div
                      className="hidden sm:block border-l pl-6"
                      style={{ borderColor: 'var(--border-hairline)' }}
                    >
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        PASSENGERS &amp; SEATS
                      </div>
                      <div className="mt-0.5 text-xs font-bold" style={{ color: 'var(--text-bright)' }}>
                        {b.passengers
                          .map((p) => `${p.fullName} (${p.seatNumber})`)
                          .join(', ')}
                      </div>
                      <div className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text-brand)' }}>
                        Paid: {formatInr(b.totalAmountPaise)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {b.status === 'CONFIRMED' && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleOpenBoardingPass(b.id)}
                          disabled={loadingTicketId === b.id}
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all"
                          style={{
                            backgroundColor: 'var(--brand-primary)',
                            color: 'var(--text-inverse)',
                            boxShadow: 'var(--shadow-glow-primary)'
                          }}
                        >
                          <QrCode className="h-4 w-4" />
                          {loadingTicketId === b.id ? 'Loading QR...' : 'E-Boarding Pass'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleOpenRefundPreview(b.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-bold"
                          style={{
                            backgroundColor: 'var(--danger-crimson-subtle)',
                            color: 'var(--danger-crimson)'
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Cancel &amp; Refund
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cryptographic Notched Boarding Pass Modal */}
      <BoardingPassModal data={activePassData} onClose={() => setActivePassData(null)} />

      {/* Deterministic Refund Preview & Cancellation Modal */}
      {refundPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-md rounded-3xl p-6"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-modal)'
            }}
          >
            <button
              type="button"
              onClick={() => setRefundPreview(null)}
              className="absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'var(--surface-hover)',
                color: 'var(--text-secondary)'
              }}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="font-mono text-xs font-bold uppercase" style={{ color: 'var(--warning-amber)' }}>
              DETERMINISTIC REFUND CALCULATOR · PNR {refundPreview.pnr}
            </div>
            <h3 className="mt-1 text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Confirm Booking Cancellation
            </h3>

            <div
              className="mt-4 space-y-2 rounded-2xl p-4 font-mono text-xs"
              style={{ backgroundColor: 'var(--canvas-subtle)' }}
            >
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Hours Before Departure</span>
                <span className="font-bold" style={{ color: 'var(--text-bright)' }}>
                  {refundPreview.hoursBeforeDeparture} hrs
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Eligible Refund Tier</span>
                <span className="font-bold" style={{ color: 'var(--signal-emerald)' }}>
                  {refundPreview.refundPercentage}%
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Cancellation Fee</span>
                <span style={{ color: 'var(--danger-crimson)' }}>
                  -{formatInr(refundPreview.cancellationFeePaise)}
                </span>
              </div>
              <div
                className="flex justify-between pt-2 text-sm font-extrabold"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text-bright)' }}>Net Refund</span>
                <span style={{ color: 'var(--signal-emerald)' }}>
                  {formatInr(refundPreview.refundAmountPaise)}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <label
                className="mb-1 block font-mono text-[10px] font-bold uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancellation Reason
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              />
            </div>

            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Cancelling immediately invalidates all Ed25519 QR boarding passes and releases your
              seats back to live inventory.
            </p>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRefundPreview(null)}
                className="flex-1 rounded-xl py-2.5 text-xs font-bold"
                style={{
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-secondary)'
                }}
              >
                Keep Ticket
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void handleConfirmCancellation()}
                className="flex-1 rounded-xl py-2.5 text-xs font-extrabold"
                style={{
                  backgroundColor: 'var(--danger-crimson)',
                  color: '#FFFFFF'
                }}
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}