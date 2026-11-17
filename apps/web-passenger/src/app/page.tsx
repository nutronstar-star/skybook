'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Calendar,
  Clock,
  Plane,
  Search,
  Sparkles,
  Users,
  SlidersHorizontal,
  ArrowRight
} from 'lucide-react';
import {
  apiFetch,
  ApiClientError,
  formatDuration,
  formatInr,
  formatIstTime,
  type ActiveLockGroup,
  type AirportSuggestion,
  type FlightSearchItem
} from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

function getTomorrowYmd(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export default function FlightDiscoveryPage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  // Search form state
  const [originQuery, setOriginQuery] = useState('DEL · New Delhi');
  const [originIata, setOriginIata] = useState('DEL');
  const [originSuggestions, setOriginSuggestions] = useState<AirportSuggestion[]>([]);
  const [showOriginMenu, setShowOriginMenu] = useState(false);

  const [destQuery, setDestQuery] = useState('BOM · Mumbai');
  const [destIata, setDestIata] = useState('BOM');
  const [destSuggestions, setDestSuggestions] = useState<AirportSuggestion[]>([]);
  const [showDestMenu, setShowDestMenu] = useState(false);

  const [tripType, setTripType] = useState<'ONE_WAY' | 'ROUND_TRIP'>('ONE_WAY');
  const [date, setDate] = useState(getTomorrowYmd);
  const [returnDate, setReturnDate] = useState(() =>
    new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  );
  const [cabinClass, setCabinClass] = useState<'ECONOMY' | 'BUSINESS'>('ECONOMY');
  const [timeOfDay, setTimeOfDay] = useState<string>('');
  const [sortBy, setSortBy] = useState<'departure' | 'price' | 'duration'>('departure');

  // Search results state
  const [outboundFlights, setOutboundFlights] = useState<FlightSearchItem[]>([]);
  const [inboundFlights, setInboundFlights] = useState<FlightSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLocks, setActiveLocks] = useState<ActiveLockGroup[]>([]);

  // Resume abandoned checkout locks if passenger is signed in (FR-PAX-018)
  useEffect(() => {
    if (!accessToken) {
      setActiveLocks([]);
      return;
    }
    void apiFetch<{ data: ActiveLockGroup[] }>('/v1/seats/lock/active', {
      token: accessToken
    })
      .then((res) => setActiveLocks(res.data))
      .catch(() => setActiveLocks([]));
  }, [accessToken]);

  const executeSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        origin: originIata,
        destination: destIata,
        date,
        cabinClass,
        sortBy,
        sortOrder: 'asc'
      });
      if (tripType === 'ROUND_TRIP' && returnDate) {
        qs.set('returnDate', returnDate);
      }
      if (timeOfDay) {
        qs.set('timeOfDay', timeOfDay);
      }

      const res = await apiFetch<{
        tripType: 'ONE_WAY' | 'ROUND_TRIP';
        outbound: FlightSearchItem[];
        inbound?: FlightSearchItem[];
      }>(`/v1/flights/search?${qs.toString()}`);

      setOutboundFlights(res.outbound);
      setInboundFlights(res.inbound ?? []);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to search flights');
      setOutboundFlights([]);
      setInboundFlights([]);
    } finally {
      setLoading(false);
    }
  }, [originIata, destIata, date, returnDate, tripType, cabinClass, timeOfDay, sortBy]);

  useEffect(() => {
    void executeSearch();
  }, [executeSearch]);

  const handleOriginInput = async (val: string) => {
    setOriginQuery(val);
    const cleaned = val.split('·')[0]?.trim() || val.trim();
    if (cleaned.length >= 1) {
      try {
        const res = await apiFetch<{ data: AirportSuggestion[] }>(
          `/v1/cities/autocomplete?q=${encodeURIComponent(cleaned)}`
        );
        setOriginSuggestions(res.data);
        setShowOriginMenu(true);
      } catch {
        setOriginSuggestions([]);
      }
    }
  };

  const handleDestInput = async (val: string) => {
    setDestQuery(val);
    const cleaned = val.split('·')[0]?.trim() || val.trim();
    if (cleaned.length >= 1) {
      try {
        const res = await apiFetch<{ data: AirportSuggestion[] }>(
          `/v1/cities/autocomplete?q=${encodeURIComponent(cleaned)}`
        );
        setDestSuggestions(res.data);
        setShowDestMenu(true);
      } catch {
        setDestSuggestions([]);
      }
    }
  };

  const handleSwapRoutes = () => {
    const prevOQuery = originQuery;
    const prevOIata = originIata;
    setOriginQuery(destQuery);
    setOriginIata(destIata);
    setDestQuery(prevOQuery);
    setDestIata(prevOIata);
  };

  const renderFlightCard = (flight: FlightSearchItem) => {
    const farePaise =
      cabinClass === 'BUSINESS' ? flight.businessBasePaise : flight.economyBasePaise;
    const seatsLeft =
      cabinClass === 'BUSINESS'
        ? flight.seatsAvailable.business
        : flight.seatsAvailable.economy;

    return (
      <div
        key={flight.id}
        className="group rounded-2xl p-6 transition-all"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-ambient)'
        }}
      >
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          {/* Airline & Flight Callsign */}
          <div className="flex items-center gap-4 lg:w-56">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{
                backgroundColor: 'var(--brand-primary-subtle)',
                border: '1px solid var(--brand-primary-border)',
                color: 'var(--text-brand)'
              }}
            >
              <Plane className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-extrabold" style={{ color: 'var(--text-bright)' }}>
                {flight.airlineName}
              </div>
              <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                {flight.flightNumber} · {flight.aircraft.code}
              </div>
            </div>
          </div>

          {/* Departure -> Great Circle Duration -> Arrival */}
          <div className="flex flex-1 items-center justify-between gap-4 sm:px-4">
            <div>
              <div
                className="font-mono text-2xl font-extrabold"
                style={{ color: 'var(--text-bright)' }}
              >
                {formatIstTime(flight.departureTime)}
              </div>
              <div
                className="font-mono text-xs font-bold"
                style={{ color: 'var(--text-brand)' }}
              >
                {flight.origin.iataCode} · {flight.origin.cityName}
              </div>
            </div>

            <div className="flex flex-1 flex-col items-center px-2">
              <span
                className="mb-1.5 font-mono text-[11px] font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                {formatDuration(flight.durationMinutes)}
              </span>
              <div className="relative flex w-full max-w-[180px] items-center">
                <div
                  className="h-[2px] w-full rounded-full"
                  style={{ backgroundColor: 'var(--border-strong)' }}
                />
                <Plane
                  className="absolute left-1/2 h-4 w-4 -translate-x-1/2"
                  style={{ color: 'var(--telemetry-cyan)' }}
                />
              </div>
              <span
                className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--signal-emerald)' }}
              >
                NON-STOP · ON TIME
              </span>
            </div>

            <div className="text-right">
              <div
                className="font-mono text-2xl font-extrabold"
                style={{ color: 'var(--text-bright)' }}
              >
                {formatIstTime(flight.arrivalTime)}
              </div>
              <div
                className="font-mono text-xs font-bold"
                style={{ color: 'var(--text-brand)' }}
              >
                {flight.destination.iataCode} · {flight.destination.cityName}
              </div>
            </div>
          </div>

          {/* Fare & Cabin Seat Map CTA */}
          <div
            className="flex items-center justify-between gap-5 pt-4 lg:w-64 lg:justify-end lg:border-l lg:pl-6 lg:pt-0"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div className="lg:text-right">
              <div
                className="font-mono text-2xl font-extrabold"
                style={{ color: 'var(--text-bright)' }}
              >
                {formatInr(farePaise)}
              </div>
              <div className="font-mono text-[11px]" style={{ color: 'var(--signal-emerald)' }}>
                {seatsLeft} {cabinClass} seats open
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push(`/flights/${flight.id}/seats?cabinClass=${cabinClass}`)
              }
              className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-extrabold tracking-wide transition-all"
              style={{
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-glow-primary)'
              }}
            >
              Select Seats
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Resume Abandoned Checkout Lock Banner (FR-PAX-018) */}
      {activeLocks.length > 0 && (
        <div
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4"
          style={{
            backgroundColor: 'var(--warning-amber-subtle)',
            border: '1px solid var(--warning-amber)'
          }}
        >
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 shrink-0" style={{ color: 'var(--warning-amber)' }} />
            <div>
              <div className="text-sm font-extrabold" style={{ color: 'var(--text-bright)' }}>
                Active Seat Hold Detected ({activeLocks[0]!.flight.flightNumber}:{' '}
                {activeLocks[0]!.seats.map((s) => s.seatNumber).join(', ')})
              </div>
              <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                Your cabin seats are reserved until{' '}
                {formatIstTime(activeLocks[0]!.expiresAt)} IST
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/checkout/${activeLocks[0]!.lockId}`)}
            className="rounded-xl px-4 py-2 text-xs font-extrabold"
            style={{
              backgroundColor: 'var(--warning-amber)',
              color: '#050914'
            }}
          >
            Resume Checkout →
          </button>
        </div>
      )}

      {/* Hero Header */}
      <section className="mb-8">
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1 font-mono text-[11px] font-bold"
          style={{
            backgroundColor: 'var(--brand-primary-subtle)',
            border: '1px solid var(--brand-primary-border)',
            color: 'var(--text-brand)'
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          REAL-TIME INVENTORY · ED25519 CRYPTOGRAPHIC BOARDING PASSES
        </div>
        <h1
          className="text-3xl font-extrabold tracking-tight sm:text-4xl"
          style={{ color: 'var(--text-bright)' }}
        >
          Precision Aviation Booking &amp; Live Cabin Matrix
        </h1>
        <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          Search published domestic corridors, lock your exact 3-3 fuselage seat in real time via
          WebSockets, and receive an offline-verifiable cryptographic QR e-ticket.
        </p>
      </section>

      {/* Search Console Card */}
      <section
        className="mb-10 rounded-3xl p-6 sm:p-7"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-floating)'
        }}
      >
        {/* Top Row: Trip Type & Cabin Selector */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {(['ONE_WAY', 'ROUND_TRIP'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTripType(t)}
                className="rounded-full px-4 py-1.5 font-mono text-xs font-bold transition-all"
                style={{
                  backgroundColor:
                    tripType === t ? 'var(--brand-primary)' : 'var(--canvas-subtle)',
                  color: tripType === t ? 'var(--text-inverse)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {t === 'ONE_WAY' ? 'ONE WAY' : 'ROUND TRIP'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            {(['ECONOMY', 'BUSINESS'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCabinClass(c)}
                className="rounded-full px-3.5 py-1.5 font-mono text-xs font-bold transition-all"
                style={{
                  backgroundColor:
                    cabinClass === c ? 'var(--brand-primary-subtle)' : 'transparent',
                  color: cabinClass === c ? 'var(--text-brand)' : 'var(--text-secondary)',
                  border:
                    cabinClass === c
                      ? '1px solid var(--brand-primary-border)'
                      : '1px solid transparent'
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Route & Date Grid */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {/* Origin Autocomplete */}
          <div className="relative md:col-span-4">
            <label
              className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Origin Airport
            </label>
            <input
              type="text"
              value={originQuery}
              onFocus={() => setShowOriginMenu(originSuggestions.length > 0)}
              onBlur={() => setTimeout(() => setShowOriginMenu(false), 180)}
              onChange={(e) => void handleOriginInput(e.target.value)}
              placeholder="City or IATA (e.g. DEL)"
              className="w-full rounded-xl px-4 py-3 text-sm font-bold focus:outline-none"
              style={{
                backgroundColor: 'var(--canvas-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-bright)'
              }}
            />
            {showOriginMenu && originSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: 'var(--shadow-floating)'
                }}
              >
                {originSuggestions.map((item) => (
                  <button
                    key={item.airportId}
                    type="button"
                    onMouseDown={() => {
                      setOriginIata(item.iataCode);
                      setOriginQuery(`${item.iataCode} · ${item.cityName}`);
                      setShowOriginMenu(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs transition-colors hover:opacity-90"
                    style={{ borderBottom: '1px solid var(--border-hairline)' }}
                  >
                    <div>
                      <div className="font-bold" style={{ color: 'var(--text-bright)' }}>
                        {item.cityName}, {item.state}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>{item.airportName}</div>
                    </div>
                    <span
                      className="rounded-md px-2 py-1 font-mono font-extrabold"
                      style={{
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--text-brand)'
                      }}
                    >
                      {item.iataCode}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Swap Button */}
          <div className="flex items-end justify-center md:col-span-1">
            <button
              type="button"
              onClick={handleSwapRoutes}
              title="Swap Origin & Destination"
              className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform active:scale-95"
              style={{
                backgroundColor: 'var(--canvas-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-brand)'
              }}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          </div>

          {/* Destination Autocomplete */}
          <div className="relative md:col-span-4">
            <label
              className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Destination Airport
            </label>
            <input
              type="text"
              value={destQuery}
              onFocus={() => setShowDestMenu(destSuggestions.length > 0)}
              onBlur={() => setTimeout(() => setShowDestMenu(false), 180)}
              onChange={(e) => void handleDestInput(e.target.value)}
              placeholder="City or IATA (e.g. BOM)"
              className="w-full rounded-xl px-4 py-3 text-sm font-bold focus:outline-none"
              style={{
                backgroundColor: 'var(--canvas-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-bright)'
              }}
            />
            {showDestMenu && destSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: 'var(--surface-elevated)',
                  border: '1px solid var(--border-strong)',
                  boxShadow: 'var(--shadow-floating)'
                }}
              >
                {destSuggestions.map((item) => (
                  <button
                    key={item.airportId}
                    type="button"
                    onMouseDown={() => {
                      setDestIata(item.iataCode);
                      setDestQuery(`${item.iataCode} · ${item.cityName}`);
                      setShowDestMenu(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs transition-colors hover:opacity-90"
                    style={{ borderBottom: '1px solid var(--border-hairline)' }}
                  >
                    <div>
                      <div className="font-bold" style={{ color: 'var(--text-bright)' }}>
                        {item.cityName}, {item.state}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>{item.airportName}</div>
                    </div>
                    <span
                      className="rounded-md px-2 py-1 font-mono font-extrabold"
                      style={{
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--text-brand)'
                      }}
                    >
                      {item.iataCode}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Departure Date */}
          <div className={tripType === 'ROUND_TRIP' ? 'md:col-span-3' : 'md:col-span-3'}>
            <label
              className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Departure Date
            </label>
            <div className="relative">
              <Calendar
                className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl py-2.5 pl-10 pr-3 font-mono text-sm font-semibold focus:outline-none"
                style={{
                  backgroundColor: 'var(--canvas-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-bright)'
                }}
              />
            </div>
          </div>
        </div>

        {/* Bottom Filter & Search Bar */}
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-4 pt-4"
          style={{ borderTop: '1px solid var(--border-hairline)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold"
              style={{ color: 'var(--text-muted)' }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              WINDOW:
            </span>
            {[
              { value: '', label: 'All Day' },
              { value: 'MORNING', label: '06–12h' },
              { value: 'AFTERNOON', label: '12–18h' },
              { value: 'EVENING', label: '18–24h' }
            ].map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setTimeOfDay(w.value)}
                className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold"
                style={{
                  backgroundColor:
                    timeOfDay === w.value ? 'var(--brand-primary-subtle)' : 'var(--canvas-subtle)',
                  color: timeOfDay === w.value ? 'var(--text-brand)' : 'var(--text-secondary)',
                  border:
                    timeOfDay === w.value
                      ? '1px solid var(--brand-primary-border)'
                      : '1px solid transparent'
                }}
              >
                {w.label}
              </button>
            ))}

            {tripType === 'ROUND_TRIP' && (
              <div className="ml-2 flex items-center gap-2">
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  RETURN:
                </span>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="rounded-lg px-2.5 py-1 font-mono text-xs font-semibold"
                  style={{
                    backgroundColor: 'var(--canvas-subtle)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-bright)'
                  }}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'departure' | 'price' | 'duration')}
              className="rounded-xl px-3 py-2.5 font-mono text-xs font-semibold focus:outline-none"
              style={{
                backgroundColor: 'var(--canvas-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)'
              }}
            >
              <option value="departure">Sort: Earliest Departure</option>
              <option value="price">Sort: Lowest Fare</option>
              <option value="duration">Sort: Shortest Duration</option>
            </select>

            <button
              type="button"
              onClick={() => void executeSearch()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-extrabold tracking-wide transition-all"
              style={{
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-glow-primary)'
              }}
            >
              <Search className="h-4 w-4" />
              {loading ? 'Scanning...' : 'Search Flights'}
            </button>
          </div>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <div
          className="mb-6 rounded-2xl p-4 text-sm font-semibold"
          style={{
            backgroundColor: 'var(--danger-crimson-subtle)',
            border: '1px solid var(--danger-crimson)',
            color: 'var(--danger-crimson)'
          }}
        >
          {error}
        </div>
      )}

      {/* Outbound Flights */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
            Outbound Sector · {originIata} → {destIata}
          </h2>
          <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {outboundFlights.length} flight(s) available
          </span>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-28 animate-pulse rounded-2xl"
                style={{ backgroundColor: 'var(--surface-card)' }}
              />
            ))}
          </div>
        ) : outboundFlights.length === 0 ? (
          <div
            className="rounded-2xl p-10 text-center"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div className="text-base font-bold" style={{ color: 'var(--text-bright)' }}>
              No published flights on {date} for {originIata} → {destIata}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Try tomorrow&apos;s date ({getTomorrowYmd()}) or clear the time-of-day filter.
            </p>
          </div>
        ) : (
          <div className="space-y-4">{outboundFlights.map(renderFlightCard)}</div>
        )}
      </section>

      {/* Inbound Flights (Round Trip) */}
      {tripType === 'ROUND_TRIP' && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Return Sector · {destIata} → {originIata}
            </h2>
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {inboundFlights.length} flight(s) available
            </span>
          </div>
          <div className="space-y-4">
            {inboundFlights.length === 0 ? (
              <div
                className="rounded-2xl p-6 text-center text-xs"
                style={{
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                No return flights scheduled on {returnDate}.
              </div>
            ) : (
              inboundFlights.map(renderFlightCard)
            )}
          </div>
        </section>
      )}

      {/* Live Telemetry & Radar HUD Strip (brand.html Section 06) */}
      <section
        className="mt-12 rounded-3xl p-6 sm:p-8"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-ambient)'
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-base font-extrabold" style={{ color: 'var(--text-bright)' }}>
              SkyBook Live Airspace Telemetry · DEL → BLR Corridor
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              ADS-B STREAM · AIRBUS A321NEO · CRUISE FL360
            </div>
          </div>

          <div
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1 font-mono text-[11px] font-bold"
            style={{
              backgroundColor: 'var(--signal-emerald-subtle)',
              border: '1px solid var(--signal-emerald)',
              color: 'var(--signal-emerald)'
            }}
          >
            <span
              className="sb-live-dot h-2 w-2 rounded-full"
              style={{ backgroundColor: 'var(--signal-emerald)' }}
            />
            AIRBORNE · ON TIME
          </div>
        </div>

        <div
          className="relative my-8 h-2 rounded-full"
          style={{ backgroundColor: 'var(--surface-sunken)' }}
        >
          <div
            className="h-full w-[72%] rounded-full"
            style={{
              background: 'linear-gradient(90deg, var(--brand-primary), var(--telemetry-cyan))'
            }}
          />
          <div
            className="absolute left-[72%] top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '2px solid var(--telemetry-cyan)',
              boxShadow: '0 0 16px var(--telemetry-cyan)'
            }}
          >
            <Plane className="h-4 w-4" style={{ color: 'var(--telemetry-cyan)' }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--canvas-subtle)' }}
          >
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              CRUISE ALTITUDE
            </div>
            <div className="mt-1 font-mono text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              36,000 ft
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--signal-emerald)' }}>
              Mach 0.79 · 845 km/h
            </div>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--canvas-subtle)' }}
          >
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              ARRIVAL GATE
            </div>
            <div className="mt-1 font-mono text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Terminal 2 · Gate B14
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--telemetry-cyan)' }}>
              Landing in 42 Min
            </div>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: 'var(--canvas-subtle)' }}
          >
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              CRYPTOGRAPHIC SECURITY
            </div>
            <div className="mt-1 font-mono text-lg font-extrabold" style={{ color: 'var(--text-bright)' }}>
              Ed25519 + AES-256
            </div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-brand)' }}>
              Zero-Tamper Gate QR
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}