export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4000';

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
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const mergedHeaders = new Headers(headers);

  if (rest.body && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json');
  }
  if (token) {
    mergedHeaders.set('Authorization', `Bearer ${token}`);
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
    const errPayload = json as { error?: { code?: string; message?: string } };
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

export interface AdminFlight {
  id: string;
  flightNumber: string;
  airlineName: string;
  originAirport: { iataCode: string; name: string; city: { name: string } };
  destinationAirport: { iataCode: string; name: string; city: { name: string } };
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  economyBasePaise: number;
  businessBasePaise: number;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  _count: { bookings: number; flightSeats: number };
}

export interface MaskedBookingRow {
  id: string;
  pnr: string;
  status: string;
  cabinClass: string;
  totalAmountPaise: number;
  currency: string;
  createdAt: string;
  flight: {
    id: string;
    flightNumber: string;
    route: string;
    departureTime: string;
  };
  accountContactMasked: {
    phone: string | null;
    email: string | null;
  };
  passengers: Array<{
    id: string;
    seatNumber: string;
    fullNameMasked: string;
    govtIdType: string;
    govtIdMasked: string;
  }>;
}

export interface AdminRefundRow {
  id: string;
  bookingId: string;
  amountPaise: number;
  refundPercentage: number;
  status: 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
  reason: string;
  createdAt: string;
  booking: {
    pnr: string;
    totalAmountPaise: number;
    status: string;
    flight: { flightNumber: string; departureTime: string };
  };
}

export interface RevenueDashboardResponse {
  summary: {
    confirmedBookingsCount: number;
    totalRevenuePaise: number;
    totalRefundsCount: number;
    totalRefundedPaise: number;
    netRevenuePaise: number;
  };
  daily: Array<{ date: string; bookings: number; revenuePaise: number }>;
  byFlight: Array<{ flightId: string; flightNumber: string; route: string; bookings: number; revenuePaise: number }>;
  byCabinClass: Array<{ cabinClass: string; bookings: number; revenuePaise: number }>;
}