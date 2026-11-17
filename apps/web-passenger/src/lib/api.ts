export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4000';

export const WS_SEATS_URL =
  process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/v1/ws/seats';

export interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null; idempotencyKey?: string } = {}
): Promise<T> {
  const { token, idempotencyKey, headers, ...rest } = options;
  const mergedHeaders = new Headers(headers);

  if (rest.body && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json');
  }
  if (token) {
    mergedHeaders.set('Authorization', `Bearer ${token}`);
  }
  if (idempotencyKey) {
    mergedHeaders.set('Idempotency-Key', idempotencyKey);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: mergedHeaders
  });

  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!res.ok) {
    const errPayload = json as ApiErrorShape;
    throw new ApiClientError(
      res.status,
      errPayload.error?.code || 'API_ERROR',
      errPayload.error?.message || `Request failed with status ${res.status}`
    );
  }

  return json as T;
}

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2
  }).format(rupees);
}

export function formatIstTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  });
}

export function formatIstDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// Domain Interfaces matching @skybook/api
export interface AirportSuggestion {
  airportId: string;
  iataCode: string;
  airportName: string;
  cityId: string;
  cityName: string;
  state: string;
  country: string;
}

export interface FlightSearchItem {
  id: string;
  flightNumber: string;
  airlineName: string;
  origin: {
    iataCode: string;
    airportName: string;
    cityName: string;
  };
  destination: {
    iataCode: string;
    airportName: string;
    cityName: string;
  };
  aircraft: {
    code: string;
    name: string;
    totalSeats: number;
  };
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  economyBasePaise: number;
  businessBasePaise: number;
  effectiveFarePaise: number;
  seatsAvailable: {
    total: number;
    economy: number;
    business: number;
  };
  status: string;
}

export interface SeatMapSeat {
  id: string;
  seatNumber: string;
  rowNumber: number;
  columnLetter: string;
  cabinClass: 'ECONOMY' | 'BUSINESS';
  farePaise: number;
  status: 'AVAILABLE' | 'LOCKED' | 'BOOKED';
  isExitRow: boolean;
  isWindow: boolean;
  lockedUntil?: string;
}

export interface FlightSeatMapResponse {
  flightId: string;
  flightNumber: string;
  aircraft: {
    id: string;
    code: string;
    name: string;
    totalSeats: number;
    businessSeats: number;
    economySeats: number;
  };
  economyBasePaise: number;
  businessBasePaise: number;
  seats: SeatMapSeat[];
}

export interface ActiveLockGroup {
  lockId: string;
  flightId: string;
  expiresAt: string;
  flight: {
    id: string;
    flightNumber: string;
    departureTime: string;
    arrivalTime: string;
    originAirport: { iataCode: string };
    destinationAirport: { iataCode: string };
  };
  seats: Array<{
    id: string;
    seatNumber: string;
    cabinClass: 'ECONOMY' | 'BUSINESS';
    farePaise: number;
  }>;
}

export interface PassengerBookingSummary {
  id: string;
  pnr: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
  cabinClass: 'ECONOMY' | 'BUSINESS';
  totalAmountPaise: number;
  currency: string;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  flight: {
    id: string;
    flightNumber: string;
    airlineName: string;
    origin: { iataCode: string; cityName: string };
    destination: { iataCode: string; cityName: string };
    departureTime: string;
    arrivalTime: string;
    durationMinutes: number;
  };
  passengers: Array<{
    id: string;
    seatNumber: string;
    cabinClass: 'ECONOMY' | 'BUSINESS';
    fullName: string;
  }>;
  tickets: Array<{
    id: string;
    seatLabel: string;
    status: 'ACTIVE' | 'CANCELLED';
    issuedAt: string;
  }>;
  latestPayment: {
    id: string;
    status: string;
    razorpayOrderId: string;
  } | null;
}

export interface BookingTicketsResponse {
  bookingId: string;
  pnr: string;
  bookingStatus: string;
  cabinClass: 'ECONOMY' | 'BUSINESS';
  flight: {
    id: string;
    flightNumber: string;
    airlineName: string;
    origin: { iataCode: string; cityName: string };
    destination: { iataCode: string; cityName: string };
    departureTime: string;
    arrivalTime: string;
  };
  tickets: Array<{
    ticketId: string;
    seatLabel: string;
    passengerName: string;
    status: 'ACTIVE' | 'CANCELLED';
    issuedAt: string;
    cancelledAt: string | null;
    qrToken: string;
  }>;
}

export interface RefundPreviewResponse {
  bookingId: string;
  pnr: string;
  bookingStatus: string;
  cancellable: boolean;
  departureTime: string;
  hoursBeforeDeparture: number;
  refundPercentage: number;
  paidAmountPaise: number;
  refundAmountPaise: number;
  cancellationFeePaise: number;
}