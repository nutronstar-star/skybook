const DEFAULT_API_URL =
  process.env.NODE_ENV === 'production'
    ? 'https://skybook-api-zde1.onrender.com'
    : 'http://localhost:4000';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || DEFAULT_API_URL;

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

async function tryRefreshAdminToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    let refreshToken: string | null = null;
    let storageKey: string | null = null;
    let parsedObj: Record<string, unknown> | null = null;

    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      if (k.toLowerCase().includes('refresh') && raw.length > 20 && !raw.startsWith('{')) {
        refreshToken = raw;
        storageKey = k;
        break;
      }
      if (raw.startsWith('{') && raw.includes('refreshToken')) {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (typeof obj.refreshToken === 'string') {
          refreshToken = obj.refreshToken;
          storageKey = k;
          parsedObj = obj;
          break;
        }
      }
    }

    if (!refreshToken) return null;

    const refreshRes = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!refreshRes.ok) return null;

    const tokens = (await refreshRes.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!tokens.accessToken) return null;

    if (parsedObj && storageKey) {
      parsedObj.accessToken = tokens.accessToken;
      if (tokens.refreshToken) parsedObj.refreshToken = tokens.refreshToken;
      window.localStorage.setItem(storageKey, JSON.stringify(parsedObj));
    } else {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.toLowerCase().includes('access')) {
          window.localStorage.setItem(k, tokens.accessToken);
        }
        if (k && k.toLowerCase().includes('refresh') && tokens.refreshToken) {
          window.localStorage.setItem(k, tokens.refreshToken);
        }
      }
    }

    window.dispatchEvent(
      new CustomEvent('skybook-admin-token-refreshed', { detail: tokens })
    );
    return tokens.accessToken;
  } catch {
    return null;
  }
}

function clearExpiredAdminSession() {
  if (typeof window === 'undefined') return;
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && (k.toLowerCase().includes('skybook') || k.toLowerCase().includes('admin') || k.toLowerCase().includes('token'))) {
      toRemove.push(k);
    }
  }
  toRemove.forEach((k) => window.localStorage.removeItem(k));
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
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

  let res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: mergedHeaders
  });

  if (
    res.status === 401 &&
    token &&
    !path.includes('/auth/admin/login') &&
    !path.includes('/auth/refresh')
  ) {
    const freshToken = await tryRefreshAdminToken();
    if (freshToken) {
      mergedHeaders.set('Authorization', `Bearer ${freshToken}`);
      res = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers: mergedHeaders
      });
    } else {
      clearExpiredAdminSession();
    }
  }

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