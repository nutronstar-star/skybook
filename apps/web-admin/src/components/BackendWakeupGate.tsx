'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';

const SESSION_AWAKE_KEY = 'skybook_backend_awake_v1';

export function BackendWakeupGate({
  children
}: {
  appName?: string;
  children: React.ReactNode;
}) {
  const [awake, setAwake] = useState<boolean>(false);
  const [fadingOut, setFadingOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probeBackend = useCallback(async (forceStayOpen = false) => {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${API_BASE_URL}/v1/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(abortTimeout);

      if (!mountedRef.current) return;

      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        if (data.status === 'ok') {
          window.sessionStorage.setItem(SESSION_AWAKE_KEY, '1');
          if (!forceStayOpen) {
            setFadingOut(true);
            setTimeout(() => {
              if (mountedRef.current) {
                setAwake(true);
              }
            }, 350);
          }
          return;
        }
      }
    } catch {
      clearTimeout(abortTimeout);
    }

    if (!mountedRef.current) return;
    timerRef.current = setTimeout(() => {
      void probeBackend(forceStayOpen);
    }, 2500);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const forcePreview =
      typeof window !== 'undefined' && window.location.search.includes('wakeup=1');

    if (!forcePreview && window.sessionStorage.getItem(SESSION_AWAKE_KEY) === '1') {
      setAwake(true);
      return;
    }

    void probeBackend(forcePreview);

    const clock = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    return () => {
      mountedRef.current = false;
      clearInterval(clock);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [probeBackend]);

  if (awake) {
    return <>{children}</>;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center select-none transition-opacity duration-300 ${
        fadingOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        backgroundColor: 'var(--canvas-bg)',
        color: 'var(--text-primary)'
      }}
      role="status"
      aria-live="polite"
    >
      {/* Canonical SkyBook Vector Mark Loader (brand_2.html) */}
      <svg
        viewBox="240 210 720 760"
        className="h-60 w-60 sm:h-72 sm:w-72"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="SkyBook loading"
      >
        <defs>
          <linearGradient id="skyGradWakeup" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
          <linearGradient id="skyGlowWakeup" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0284C7" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Boarding Pass / E-Ticket Frame with Classic Ticket Notches */}
        <path
          fill="var(--logo-navy)"
          fillRule="evenodd"
          d="M 410,275 L 790,275 C 825,275 850,300 850,335 L 850,515 A 28,28 0 0 0 850,571 L 850,655 C 850,690 825,715 790,715 L 410,715 C 375,715 350,690 350,655 L 350,571 A 28,28 0 0 0 350,515 L 350,335 C 350,300 375,275 410,275 Z
             M 435,345 C 415,345 402,358 402,378 L 402,485 L 798,485 L 798,378 C 798,358 785,345 765,345 Z
             M 402,595 L 402,632 C 402,650 415,662 435,662 L 765,662 C 785,662 798,650 798,632 L 798,595 Z"
        />

        {/* Sky Window Ambient Fill */}
        <path
          fill="url(#skyGlowWakeup)"
          d="M 435,345 C 415,345 402,358 402,378 L 402,485 L 798,485 L 798,378 C 798,358 785,345 765,345 Z"
        />

        {/* Perforated Ticket Tear Line */}
        <line
          className="sb-loader-tear"
          x1="395"
          y1="543"
          x2="805"
          y2="543"
          stroke="var(--logo-sky)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="16 20"
          opacity="0.75"
        />

        {/* Flight Route Arc */}
        <path
          className="sb-loader-arc"
          d="M 425,470 C 495,435 585,395 725,365"
          fill="none"
          stroke="url(#skyGradWakeup)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray="18 18"
          opacity="0.95"
        />

        {/* Origin Departure Dot */}
        <circle cx="430" cy="468" r="10" fill="var(--logo-sky)" />

        {/* Ascending Jet Breaking Out of Top-Right Corner */}
        <g className="sb-loader-jet" transform="translate(755, 345) rotate(-32)">
          <path
            fill="url(#skyGradWakeup)"
            d="M 92,0 C 106,0 116,8 116,16 C 116,24 106,32 92,32 L 36,32 L -14,94 L -36,94 L -8,32 L -56,32 L -74,56 L -90,56 L -78,16 L -90,-24 L -74,-24 L -56,0 L -8,0 L -36,-62 L -14,-62 L 36,0 Z"
          />
        </g>

        {/* Destination Waypoint Beacon */}
        <circle className="sb-loader-beacon" cx="875" cy="272" r="11" fill="var(--logo-sky)" />

        {/* Stub Barcode Bars */}
        <g fill="var(--logo-sky)">
          <rect className="sb-loader-bar-1" x="445" y="615" width="12" height="28" rx="4" />
          <rect className="sb-loader-bar-2" x="470" y="615" width="24" height="28" rx="4" />
          <rect className="sb-loader-bar-3" x="507" y="615" width="10" height="28" rx="4" />
          <rect className="sb-loader-bar-4" x="530" y="615" width="18" height="28" rx="4" />
          <rect className="sb-loader-bar-5" x="562" y="615" width="12" height="28" rx="4" />
          <rect className="sb-loader-bar-6" x="650" y="615" width="105" height="28" rx="14" />
        </g>

        {/* Typography Wordmark: SkyBook */}
        <g
          transform="translate(600, 910)"
          textAnchor="middle"
          fontFamily="var(--font-sans), 'Plus Jakarta Sans', -apple-system, sans-serif"
          fontSize="148"
          fontWeight="800"
          letterSpacing="-4"
        >
          <text>
            <tspan fill="var(--logo-navy)">Sky</tspan>
            <tspan fill="url(#skyGradWakeup)">Book</tspan>
          </text>
        </g>
      </svg>

      {/* Single Understated Status Line */}
      <p
        className="mt-2 font-mono text-xs tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {elapsedSec < 4
          ? 'Waking up server...'
          : `Waking up server (${elapsedSec}s) · usually ready within 30s`}
      </p>
    </div>
  );
}