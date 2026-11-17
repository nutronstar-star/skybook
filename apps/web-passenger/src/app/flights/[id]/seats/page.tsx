'use client';

import React, { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  Radio,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import {
  apiFetch,
  ApiClientError,
  formatInr,
  WS_SEATS_URL,
  type FlightSeatMapResponse,
  type SeatMapSeat
} from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

function CabinSeatMapContent({ flightId }: { flightId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredCabin =
    searchParams.get('cabinClass') === 'BUSINESS' ? 'BUSINESS' : 'ECONOMY';

  const { accessToken, openAuthModal } = useAuth();

  const [seatMap, setSeatMap] = useState<FlightSeatMapResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSeatMap = useCallback(async () => {
    try {
      const data = await apiFetch<FlightSeatMapResponse>(
        `/v1/flights/${flightId}/seat-map`
      );
      setSeatMap(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load cabin map');
    } finally {
      setLoading(false);
    }
  }, [flightId]);

  useEffect(() => {
    void loadSeatMap();
  }, [loadSeatMap]);

  // Real-Time WebSocket Seat Status Subscription (FR-PAX-017, EI-07)
  useEffect(() => {
    if (!accessToken || !flightId) {
      setWsConnected(false);
      return;
    }

    const ws = new WebSocket(WS_SEATS_URL);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'AUTH',
          token: accessToken,
          flightId
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          seatIds?: string[];
        };

        if (msg.type === 'AUTH_OK') {
          setWsConnected(true);
          return;
        }

        if (
          msg.seatIds &&
          (msg.type === 'SEAT_LOCKED' ||
            msg.type === 'SEAT_RELEASED' ||
            msg.type === 'SEAT_BOOKED' ||
            msg.type === 'SEAT_AVAILABLE')
        ) {
          const nextStatus: SeatMapSeat['status'] =
            msg.type === 'SEAT_LOCKED'
              ? 'LOCKED'
              : msg.type === 'SEAT_BOOKED'
                ? 'BOOKED'
                : 'AVAILABLE';

          setSeatMap((prev) => {
            if (!prev) return prev;
            const changed = new Set(msg.seatIds);
            return {
              ...prev,
              seats: prev.seats.map((s) =>
                changed.has(s.id) ? { ...s, status: nextStatus } : s
              )
            };
          });

          if (nextStatus !== 'AVAILABLE') {
            setSelectedIds((prev) => prev.filter((id) => !msg.seatIds!.includes(id)));
          }
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    return () => {
      ws.close();
    };
  }, [accessToken, flightId]);

  const rows = useMemo(() => {
    if (!seatMap) return [];
    const grouped = new Map<number, SeatMapSeat[]>();
    for (const seat of seatMap.seats) {
      const list = grouped.get(seat.rowNumber) ?? [];
      list.push(seat);
      grouped.set(seat.rowNumber, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  }, [seatMap]);

  const selectedSeats = useMemo(() => {
    if (!seatMap) return [];
    const set = new Set(selectedIds);
    return seatMap.seats.filter((s) => set.has(s.id));
  }, [seatMap, selectedIds]);

  const totalFarePaise = useMemo(
    () => selectedSeats.reduce((sum, s) => sum + s.farePaise, 0),
    [selectedSeats]
  );

  const handleToggleSeat = (seat: SeatMapSeat) => {
    if (seat.status !== 'AVAILABLE') return;
    setError(null);

    if (selectedIds.includes(seat.id)) {
      setSelectedIds((prev) => prev.filter((id) => id !== seat.id));
      return;
    }

    if (selectedSeats.length > 0 && selectedSeats[0]!.cabinClass !== seat.cabinClass) {
      setError(
        `All seats in one booking must be in ${selectedSeats[0]!.cabinClass} cabin.`
      );
      return;
    }

    if (selectedIds.length >= 6) {
      setError('Maximum 6 seats can be locked per booking.');
      return;
    }

    setSelectedIds((prev) => [...prev, seat.id]);
  };

  const lockSelectedSeats = async (tokenToUse: string) => {
    if (selectedIds.length === 0) return;
    setLocking(true);
    setError(null);
    try {
      const lockRes = await apiFetch<{ lockId: string }>('/v1/seats/lock', {
        method: 'POST',
        token: tokenToUse,
        body: JSON.stringify({
          flightId,
          seatIds: selectedIds
        })
      });
      router.push(`/checkout/${lockRes.lockId}`);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Selected seat was just claimed by another passenger'
      );
      await loadSeatMap();
    } finally {
      setLocking(false);
    }
  };

  const handleProceed = () => {
    if (selectedIds.length === 0) return;
    if (!accessToken) {
      openAuthModal((freshToken) => {
        void lockSelectedSeats(freshToken);
      });
      return;
    }
    void lockSelectedSeats(accessToken);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div
          className="h-96 animate-pulse rounded-3xl"
          style={{ backgroundColor: 'var(--surface-card)' }}
        />
      </div>
    );
  }

  if (!seatMap) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-base font-bold" style={{ color: 'var(--danger-crimson)' }}>
          {error || 'Flight not found'}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)'
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Search
        </button>

        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1 font-mono text-[11px] font-bold"
            style={{
              backgroundColor: wsConnected
                ? 'var(--signal-emerald-subtle)'
                : 'var(--brand-primary-subtle)',
              border: `1px solid ${wsConnected ? 'var(--signal-emerald)' : 'var(--brand-primary-border)'}`,
              color: wsConnected ? 'var(--signal-emerald)' : 'var(--text-brand)'
            }}
          >
            <Radio className="h-3.5 w-3.5" />
            {wsConnected
              ? 'LIVE WEBSOCKET CABIN SYNC ACTIVE'
              : 'SIGN IN FOR REAL-TIME SEAT STREAM'}
          </span>
        </div>
      </div>

      {error && (
        <div
          className="mb-6 flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold"
          style={{
            backgroundColor: 'var(--danger-crimson-subtle)',
            border: '1px solid var(--danger-crimson)',
            color: 'var(--danger-crimson)'
          }}
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Rounded Aircraft Fuselage Seat Matrix */}
        <div className="lg:col-span-7">
          <div
            className="rounded-3xl p-6 sm:p-8"
            style={{
              backgroundColor: 'var(--canvas-subtle)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div className="mb-6 text-center">
              <div className="font-mono text-xs font-bold" style={{ color: 'var(--text-brand)' }}>
                {seatMap.flightNumber} · {seatMap.aircraft.name}
              </div>
              <h1 className="text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
                Interactive 3-3 Cabin Seat Map
              </h1>
            </div>

            {/* 5-State Legend */}
            <div className="mb-8 flex flex-wrap items-center justify-center gap-3 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <span className="sb-seat sb-seat-avail inline-block h-4 w-4" />
                Available
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="sb-seat sb-seat-extra inline-block h-4 w-4" />
                Exit / Extra Legroom
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="sb-seat sb-seat-sel inline-block h-4 w-4" />
                Selected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="sb-seat sb-seat-lock inline-block h-4 w-4" />
                Checkout Hold
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="sb-seat sb-seat-book inline-block h-4 w-4" />
                Occupied
              </span>
            </div>

            {/* Aircraft Fuselage Shell */}
            <div
              className="relative mx-auto max-w-[340px] px-5 pb-8 pt-16"
              style={{
                backgroundColor: 'var(--surface-card)',
                border: '2px solid var(--border-strong)',
                borderRadius: '110px 110px 28px 28px',
                boxShadow: 'var(--shadow-floating)'
              }}
            >
              {/* Cockpit Windshield */}
              <div
                className="absolute left-14 right-14 top-5 h-6"
                style={{
                  border: '1.5px solid var(--telemetry-cyan)',
                  borderRadius: '40px 40px 4px 4px',
                  background:
                    'linear-gradient(180deg, var(--telemetry-cyan-subtle), transparent)'
                }}
              />

              {/* Column Headers */}
              <div
                className="mb-3 flex items-center justify-between px-1 font-mono text-[10px] font-bold"
                style={{ color: 'var(--text-muted)' }}
              >
                <div className="flex gap-2">
                  <span className="w-9 text-center">A</span>
                  <span className="w-9 text-center">B</span>
                  <span className="w-9 text-center">C</span>
                </div>
                <span className="w-6 text-center">ROW</span>
                <div className="flex gap-2">
                  <span className="w-9 text-center">D</span>
                  <span className="w-9 text-center">E</span>
                  <span className="w-9 text-center">F</span>
                </div>
              </div>

              <div className="max-h-[520px] space-y-2.5 overflow-y-auto pr-1">
                {rows.map(([rowNum, rowSeats]) => {
                  const leftSeats = rowSeats.filter((s) =>
                    ['A', 'B', 'C'].includes(s.columnLetter)
                  );
                  const rightSeats = rowSeats.filter((s) =>
                    ['D', 'E', 'F'].includes(s.columnLetter)
                  );
                  const isBusinessRow = rowSeats[0]?.cabinClass === 'BUSINESS';

                  return (
                    <div key={rowNum}>
                      {rowNum === 1 && (
                        <div
                          className="mb-2 text-center font-mono text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--telemetry-cyan)' }}
                        >
                          — Business Cabin ({formatInr(seatMap.businessBasePaise)}) —
                        </div>
                      )}
                      {rowNum === 4 && (
                        <div
                          className="my-3 text-center font-mono text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          — Economy Cabin ({formatInr(seatMap.economyBasePaise)}) —
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex gap-1.5">
                          {leftSeats.map((seat) => {
                            const isSelected = selectedIds.includes(seat.id);
                            const cls = isSelected
                              ? 'sb-seat-sel'
                              : seat.status === 'BOOKED'
                                ? 'sb-seat-book'
                                : seat.status === 'LOCKED'
                                  ? 'sb-seat-lock'
                                  : seat.isExitRow || isBusinessRow
                                    ? 'sb-seat-extra'
                                    : 'sb-seat-avail';

                            return (
                              <button
                                key={seat.id}
                                type="button"
                                disabled={seat.status !== 'AVAILABLE'}
                                onClick={() => handleToggleSeat(seat)}
                                title={`${seat.seatNumber} · ${seat.cabinClass} · ${formatInr(seat.farePaise)}`}
                                className={`sb-seat flex h-10 w-9 items-center justify-center font-mono text-[11px] font-bold ${cls}`}
                              >
                                {seat.seatNumber}
                              </button>
                            );
                          })}
                        </div>

                        <span
                          className="w-6 text-center font-mono text-[10px] font-bold"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {rowNum}
                        </span>

                        <div className="flex gap-1.5">
                          {rightSeats.map((seat) => {
                            const isSelected = selectedIds.includes(seat.id);
                            const cls = isSelected
                              ? 'sb-seat-sel'
                              : seat.status === 'BOOKED'
                                ? 'sb-seat-book'
                                : seat.status === 'LOCKED'
                                  ? 'sb-seat-lock'
                                  : seat.isExitRow || isBusinessRow
                                    ? 'sb-seat-extra'
                                    : 'sb-seat-avail';

                            return (
                              <button
                                key={seat.id}
                                type="button"
                                disabled={seat.status !== 'AVAILABLE'}
                                onClick={() => handleToggleSeat(seat)}
                                title={`${seat.seatNumber} · ${seat.cabinClass} · ${formatInr(seat.farePaise)}`}
                                className={`sb-seat flex h-10 w-9 items-center justify-center font-mono text-[11px] font-bold ${cls}`}
                              >
                                {seat.seatNumber}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sticky Cabin Summary & Lock Drawer */}
        <div className="lg:col-span-5">
          <div
            className="sticky top-24 rounded-3xl p-6"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="font-mono text-xs font-bold uppercase"
                style={{ color: 'var(--text-brand)' }}
              >
                {seatMap.flightNumber} · CABIN SELECTION
              </span>
              <span
                className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                Preferred: {preferredCabin}
              </span>
            </div>

            <h2 className="mt-2 text-xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
              {selectedSeats.length === 0
                ? 'Tap open seats on the fuselage'
                : `${selectedSeats.length} Seat(s) Selected`}
            </h2>

            {selectedSeats.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Select up to 6 seats in the same cabin class. Locking holds your seats exclusively
                in Redis &amp; PostgreSQL for <strong>5 minutes (300s)</strong> while you enter
                passenger ID details.
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {selectedSeats.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{
                      backgroundColor: 'var(--canvas-subtle)',
                      border: '1px solid var(--border-hairline)'
                    }}
                  >
                    <div>
                      <div className="font-mono text-sm font-extrabold" style={{ color: 'var(--text-bright)' }}>
                        Seat {s.seatNumber}
                      </div>
                      <div className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {s.cabinClass} · {s.isWindow ? 'Window' : s.columnLetter === 'C' || s.columnLetter === 'D' ? 'Aisle' : 'Middle'}
                        {s.isExitRow ? ' · Exit Row' : ''}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-extrabold" style={{ color: 'var(--text-brand)' }}>
                      {formatInr(s.farePaise)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              className="mt-6 flex items-center justify-between pt-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <div>
                <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  TOTAL FARE (INCL. TAXES)
                </div>
                <div
                  className="font-mono text-2xl font-extrabold"
                  style={{ color: 'var(--text-bright)' }}
                >
                  {formatInr(totalFarePaise)}
                </div>
              </div>

              <button
                type="button"
                disabled={selectedSeats.length === 0 || locking}
                onClick={handleProceed}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-xs font-extrabold tracking-wide transition-all disabled:opacity-45"
                style={{
                  backgroundColor: 'var(--brand-primary)',
                  color: 'var(--text-inverse)',
                  boxShadow: selectedSeats.length > 0 ? 'var(--shadow-glow-primary)' : 'none'
                }}
              >
                <Lock className="h-4 w-4" />
                {locking ? 'Locking Seats...' : 'Lock & Continue'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div
              className="mt-4 flex items-center gap-2 rounded-xl p-3 text-[11px]"
              style={{
                backgroundColor: 'var(--brand-primary-subtle)',
                color: 'var(--text-brand)'
              }}
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              Atomic dual-layer lock prevents double-booking under high concurrency.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CabinSeatMapPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div
            className="h-96 animate-pulse rounded-3xl"
            style={{ backgroundColor: 'var(--surface-card)' }}
          />
        </div>
      }
    >
      <CabinSeatMapContent flightId={id} />
    </Suspense>
  );
}