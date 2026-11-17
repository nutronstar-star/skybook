'use client';

import React, { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clock,
  CreditCard,
  ShieldCheck,
  Trash2,
  UserPlus,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import {
  apiFetch,
  ApiClientError,
  formatInr,
  formatIstTime,
  type ActiveLockGroup
} from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface PassengerFormRow {
  seatId: string;
  seatNumber: string;
  cabinClass: 'ECONOMY' | 'BUSINESS';
  farePaise: number;
  fullName: string;
  age: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  govtIdType: 'AADHAAR' | 'PASSPORT' | 'PAN' | 'VOTER_ID';
  govtIdNumber: string;
}

export default function LockCheckoutPage({
  params
}: {
  params: Promise<{ lockId: string }>;
}) {
  const { lockId } = use(params);
  const router = useRouter();
  const { accessToken, user, isReady, openAuthModal } = useAuth();

  const [lockGroup, setLockGroup] = useState<ActiveLockGroup | null>(null);
  const [passengers, setPassengers] = useState<PassengerFormRow[]>([]);
  const [secondsLeft, setSecondsLeft] = useState<number>(300);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    if (!accessToken) {
      openAuthModal();
      return;
    }

    let cancelled = false;
    void apiFetch<{ data: ActiveLockGroup[] }>('/v1/seats/lock/active', {
      token: accessToken
    })
      .then((res) => {
        if (cancelled) return;
        const matched = res.data.find((g) => g.lockId === lockId) ?? null;
        setLockGroup(matched);
        if (matched) {
          setPassengers(
            matched.seats.map((s, idx) => ({
              seatId: s.id,
              seatNumber: s.seatNumber,
              cabinClass: s.cabinClass,
              farePaise: s.farePaise,
              fullName: idx === 0 && user?.fullName ? user.fullName : '',
              age: '29',
              gender: 'MALE',
              govtIdType: 'AADHAAR',
              govtIdNumber: ''
            }))
          );
          const rem = Math.max(
            0,
            Math.floor((new Date(matched.expiresAt).getTime() - Date.now()) / 1000)
          );
          setSecondsLeft(rem);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : 'Unable to load active lock');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isReady, accessToken, lockId, openAuthModal, user?.fullName]);

  // Live 1-second countdown ticker
  useEffect(() => {
    if (!lockGroup) return;
    const timer = setInterval(() => {
      const rem = Math.max(
        0,
        Math.floor((new Date(lockGroup.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(rem);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockGroup]);

  const handleReleaseLock = async () => {
    if (!accessToken) return;
    try {
      await apiFetch(`/v1/seats/lock/${lockId}`, {
        method: 'DELETE',
        token: accessToken
      });
    } catch {
      // Ignore if already expired
    }
    router.push('/');
  };

  const updatePassenger = <K extends keyof PassengerFormRow>(
    index: number,
    key: K,
    value: PassengerFormRow[K]
  ) => {
    setPassengers((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [key]: value } : row))
    );
  };

  const handleCompleteBookingAndPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !lockGroup) return;

    setSubmitting(true);
    setError(null);

    try {
      // Step 1: Convert active lock into a PENDING Booking with AES-256-GCM encrypted PII
      setStageMessage('Encrypting passenger PII & reserving PNR...');
      const booking = await apiFetch<{
        id: string;
        pnr: string;
        totalAmountPaise: number;
      }>('/v1/bookings', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({
          lockId: lockGroup.lockId,
          cabinClass: passengers[0]!.cabinClass,
          passengers: passengers.map((p) => ({
            seatId: p.seatId,
            fullName: p.fullName.trim(),
            age: Number(p.age),
            gender: p.gender,
            govtIdType: p.govtIdType,
            govtIdNumber: p.govtIdNumber.trim().toUpperCase()
          }))
        })
      });

      // Step 2: Create Idempotent Razorpay Payment Order
      setStageMessage(`Creating idempotent payment order for PNR ${booking.pnr}...`);
      const idemKey = `pax_checkout_${booking.id}_${Date.now()}`;
      const order = await apiFetch<{
        paymentIntentId: string;
        razorpayOrderId: string;
        amountPaise: number;
        mockMode: boolean;
      }>('/v1/payments/orders', {
        method: 'POST',
        token: accessToken,
        idempotencyKey: idemKey,
        body: JSON.stringify({ bookingId: booking.id })
      });

      // Step 3: Settle via signed HMAC-SHA256 webhook bridge -> triggers BullMQ ticket issuance
      setStageMessage('Verifying HMAC-SHA256 payment webhook & signing Ed25519 QR pass...');
      const settleRes = await fetch('/api/mock-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpayOrderId: order.razorpayOrderId,
          method: 'upi'
        })
      });
      if (!settleRes.ok) {
        throw new Error('Payment webhook settlement failed');
      }

      // Step 4: Poll payment status until BullMQ worker transitions booking -> CONFIRMED
      for (let i = 0; i < 25; i++) {
        const status = await apiFetch<{
          bookingStatus: string;
          paymentStatus: string;
        }>(`/v1/payments/${booking.id}/status`, {
          token: accessToken
        });
        if (status.bookingStatus === 'CONFIRMED') {
          router.push(`/trips?confirmedBookingId=${booking.id}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      router.push('/trips');
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Checkout failed'
      );
      setStageMessage(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div
          className="h-80 animate-pulse rounded-3xl"
          style={{ backgroundColor: 'var(--surface-card)' }}
        />
      </div>
    );
  }

  if (!lockGroup || secondsLeft <= 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div
          className="rounded-3xl p-8"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <Clock className="mx-auto h-10 w-10" style={{ color: 'var(--warning-amber)' }} />
          <h1 className="mt-4 text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Seat Lock Expired or Released
          </h1>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            The 300-second inventory hold has elapsed and the seats have been returned to the
            live cabin map.
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-6 rounded-xl px-6 py-3 text-xs font-extrabold"
            style={{
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-inverse)'
            }}
          >
            Search Flights Again
          </button>
        </div>
      </div>
    );
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const totalPaise = passengers.reduce((acc, p) => acc + p.farePaise, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* 300s Hold Countdown Banner */}
      <div
        className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--warning-amber)',
          boxShadow: 'var(--shadow-ambient)'
        }}
      >
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5" style={{ color: 'var(--warning-amber)' }} />
          <div>
            <div className="text-sm font-extrabold" style={{ color: 'var(--text-bright)' }}>
              {lockGroup.flight.flightNumber} ·{' '}
              {lockGroup.flight.originAirport.iataCode} →{' '}
              {lockGroup.flight.destinationAirport.iataCode}
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
              Departs {formatIstTime(lockGroup.flight.departureTime)} IST · Seats:{' '}
              {passengers.map((p) => p.seatNumber).join(', ')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              HOLD EXPIRES IN
            </div>
            <div
              className="font-mono text-xl font-extrabold"
              style={{ color: 'var(--warning-amber)' }}
            >
              {mm}:{ss}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleReleaseLock()}
            title="Release seat lock"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
            style={{
              backgroundColor: 'var(--danger-crimson-subtle)',
              color: 'var(--danger-crimson)'
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Release
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

      <form onSubmit={handleCompleteBookingAndPay} className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Passenger Manifest Forms */}
        <div className="space-y-5 lg:col-span-8">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" style={{ color: 'var(--text-brand)' }} />
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Passenger Manifest &amp; Government ID
            </h1>
          </div>

          {passengers.map((pax, idx) => (
            <div
              key={pax.seatId}
              className="rounded-3xl p-6"
              style={{
                backgroundColor: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-ambient)'
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <span
                  className="rounded-full px-3 py-1 font-mono text-xs font-extrabold"
                  style={{
                    backgroundColor: 'var(--brand-primary-subtle)',
                    color: 'var(--text-brand)'
                  }}
                >
                  PASSENGER {idx + 1} · SEAT {pax.seatNumber} ({pax.cabinClass})
                </span>
                <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-bright)' }}>
                  {formatInr(pax.farePaise)}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  <label
                    className="mb-1 block font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Full Name (As on Government ID)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={pax.fullName}
                    onChange={(e) => updatePassenger(idx, 'fullName', e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm font-semibold focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  />
                </div>

                <div className="sm:col-span-3">
                  <label
                    className="mb-1 block font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Age
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={120}
                    value={pax.age}
                    onChange={(e) => updatePassenger(idx, 'age', e.target.value)}
                    className="w-full rounded-xl px-3.5 py-2.5 font-mono text-sm font-semibold focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  />
                </div>

                <div className="sm:col-span-3">
                  <label
                    className="mb-1 block font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Gender
                  </label>
                  <select
                    value={pax.gender}
                    onChange={(e) =>
                      updatePassenger(idx, 'gender', e.target.value as PassengerFormRow['gender'])
                    }
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="sm:col-span-5">
                  <label
                    className="mb-1 block font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ID Document Type
                  </label>
                  <select
                    value={pax.govtIdType}
                    onChange={(e) =>
                      updatePassenger(
                        idx,
                        'govtIdType',
                        e.target.value as PassengerFormRow['govtIdType']
                      )
                    }
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  >
                    <option value="AADHAAR">Aadhaar Card</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="PAN">PAN Card</option>
                    <option value="VOTER_ID">Voter ID</option>
                  </select>
                </div>

                <div className="sm:col-span-7">
                  <label
                    className="mb-1 block font-mono text-[10px] font-bold uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ID Document Number (AES-256-GCM Encrypted)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    maxLength={32}
                    value={pax.govtIdNumber}
                    onChange={(e) => updatePassenger(idx, 'govtIdNumber', e.target.value)}
                    placeholder="123456789012"
                    className="w-full rounded-xl px-3.5 py-2.5 font-mono text-sm font-semibold uppercase focus:outline-none"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-bright)'
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Payment Summary & Settlement */}
        <div className="lg:col-span-4">
          <div
            className="sticky top-24 rounded-3xl p-6"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div className="font-mono text-xs font-bold uppercase" style={{ color: 'var(--text-brand)' }}>
              PAYMENT &amp; TICKET ISSUANCE
            </div>
            <h2 className="mt-1 text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Fare Summary
            </h2>

            <div className="mt-4 space-y-2 text-xs">
              {passengers.map((p) => (
                <div key={p.seatId} className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Seat {p.seatNumber} ({p.cabinClass})
                  </span>
                  <span className="font-mono font-bold" style={{ color: 'var(--text-bright)' }}>
                    {formatInr(p.farePaise)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Ed25519 QR Issuance</span>
                <span className="font-mono font-bold" style={{ color: 'var(--signal-emerald)' }}>
                  INCLUDED
                </span>
              </div>
            </div>

            <div
              className="mt-4 flex items-baseline justify-between pt-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                PAYABLE AMOUNT
              </span>
              <span
                className="font-mono text-2xl font-extrabold"
                style={{ color: 'var(--text-bright)' }}
              >
                {formatInr(totalPaise)}
              </span>
            </div>

            {stageMessage && (
              <div
                className="mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-semibold"
                style={{
                  backgroundColor: 'var(--brand-primary-subtle)',
                  color: 'var(--text-brand)'
                }}
              >
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                {stageMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-extrabold tracking-wide transition-all disabled:opacity-60"
              style={{
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-glow-primary)'
              }}
            >
              <CreditCard className="h-4 w-4" />
              {submitting ? 'Settling Payment...' : `Pay ${formatInr(totalPaise)} & Issue Pass`}
            </button>

            <div className="mt-4 space-y-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" style={{ color: 'var(--signal-emerald)' }} />
                Idempotency-Key protected Razorpay order
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--signal-emerald)' }} />
                Instant Ed25519 QR boarding pass upon settlement
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}