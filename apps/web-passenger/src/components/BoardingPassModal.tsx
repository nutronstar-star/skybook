'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Plane,
  ShieldCheck,
  Sun,
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check
} from 'lucide-react';
import {
  apiFetch,
  formatIstDate,
  formatIstTime,
  type BookingTicketsResponse
} from '@/lib/api';

interface BoardingPassModalProps {
  data: BookingTicketsResponse | null;
  onClose: () => void;
}

export function BoardingPassModal({ data, onClose }: BoardingPassModalProps) {
  const [maximizedQr, setMaximizedQr] = useState<{ value: string; label?: string } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [scannerBoost, setScannerBoost] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyState, setVerifyState] = useState<{
    valid: boolean;
    reason?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const activeTicket = data?.tickets[selectedIdx] ?? null;

  useEffect(() => {
    setSelectedIdx(0);
    setVerifyState(null);
  }, [data]);

  useEffect(() => {
    if (!activeTicket?.qrToken) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(activeTicket.qrToken, {
      width: 240,
      margin: 2,
      color: {
        dark: '#091124',
        light: '#FFFFFF'
      }
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTicket?.qrToken]);

  if (!data || !activeTicket) return null;

  const handleVerifySignature = async () => {
    setVerifying(true);
    try {
      const res = await apiFetch<{ valid: boolean; reason?: string }>('/v1/tickets/verify', {
        method: 'POST',
        body: JSON.stringify({ qrToken: activeTicket.qrToken })
      });
      setVerifyState(res);
    } catch {
      setVerifyState({ valid: false, reason: 'VERIFICATION_REQUEST_FAILED' });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(activeTicket.qrToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg">
        {/* Top Controls: Gate Scanner Optical Boost + Close */}
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setScannerBoost((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all"
            style={{
              backgroundColor: scannerBoost ? '#FFFFFF' : 'var(--surface-card)',
              color: scannerBoost ? '#091124' : 'var(--text-brand)',
              border: '1px solid var(--border-strong)'
            }}
          >
            <Sun className="h-3.5 w-3.5" />
            {scannerBoost ? 'Gate Optical Boost: ON (100%)' : 'Gate Scanner Optical Boost'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-bright)'
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Multi-Passenger Selector Tabs */}
        {data.tickets.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {data.tickets.map((t, i) => (
              <button
                key={t.ticketId}
                type="button"
                onClick={() => {
                  setSelectedIdx(i);
                  setVerifyState(null);
                }}
                className="rounded-full px-3.5 py-1.5 font-mono text-xs font-bold transition-all"
                style={{
                  backgroundColor:
                    i === selectedIdx ? 'var(--brand-primary)' : 'var(--surface-card)',
                  color: i === selectedIdx ? 'var(--text-inverse)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {t.seatLabel} · {t.passengerName.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        {/* Notched Cryptographic E-Boarding Pass Stub (brand.html Section 07) */}
        <div
          className="relative overflow-hidden rounded-3xl transition-all"
          style={{
            backgroundColor: scannerBoost ? '#FFFFFF' : 'var(--surface-card)',
            color: scannerBoost ? '#091124' : 'var(--text-primary)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--shadow-modal)'
          }}
        >
          {/* Upper Flight Segment */}
          <div
            className="relative p-7"
            style={{
              borderBottom: `2px dashed ${scannerBoost ? '#CBD5E1' : 'var(--border-strong)'}`
            }}
          >
            <div className="sb-ticket-notch-left" />
            <div className="sb-ticket-notch-right" />

            <div className="mb-4 flex items-center justify-between">
              <span
                className="font-mono text-xs font-bold uppercase tracking-wider"
                style={{ color: scannerBoost ? '#0284C7' : 'var(--text-brand)' }}
              >
                {data.flight.airlineName} · {data.flight.flightNumber}
              </span>
              <span
                className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold"
                style={{
                  backgroundColor:
                    activeTicket.status === 'ACTIVE'
                      ? 'var(--signal-emerald-subtle)'
                      : 'var(--danger-crimson-subtle)',
                  color:
                    activeTicket.status === 'ACTIVE'
                      ? 'var(--signal-emerald)'
                      : 'var(--danger-crimson)'
                }}
              >
                {activeTicket.status}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div
                  className="text-4xl font-extrabold tracking-tight"
                  style={{ color: scannerBoost ? '#091124' : 'var(--text-bright)' }}
                >
                  {data.flight.origin.iataCode}
                </div>
                <div className="text-xs opacity-75">{data.flight.origin.cityName}</div>
              </div>

              <div className="flex flex-col items-center px-4">
                <Plane
                  className="h-6 w-6"
                  style={{ color: scannerBoost ? '#0284C7' : 'var(--brand-primary)' }}
                />
                <span className="mt-1 font-mono text-[10px] opacity-65">NON-STOP</span>
              </div>

              <div className="text-right">
                <div
                  className="text-4xl font-extrabold tracking-tight"
                  style={{ color: scannerBoost ? '#091124' : 'var(--text-bright)' }}
                >
                  {data.flight.destination.iataCode}
                </div>
                <div className="text-xs opacity-75">{data.flight.destination.cityName}</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div>
                <div className="font-mono text-[10px] opacity-60">DEPARTURE (IST)</div>
                <div className="font-mono text-sm font-bold">
                  {formatIstTime(data.flight.departureTime)}
                </div>
                <div className="text-[11px] opacity-70">
                  {formatIstDate(data.flight.departureTime)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] opacity-60">CABIN SEAT</div>
                <div
                  className="font-mono text-lg font-extrabold"
                  style={{ color: scannerBoost ? '#0284C7' : 'var(--text-brand)' }}
                >
                  {activeTicket.seatLabel}
                </div>
                <div className="text-[11px] opacity-70">{data.cabinClass}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] opacity-60">BOOKING PNR</div>
                <div className="font-mono text-lg font-extrabold tracking-wider">
                  {data.pnr}
                </div>
                <div className="text-[11px] opacity-70">Ed25519 Signed</div>
              </div>
            </div>
          </div>

          {/* Lower Perforated QR Stub with Isolated High-Contrast White Island */}
          <div
            className="flex items-center justify-between gap-4 p-6"
            style={{
              backgroundColor: scannerBoost ? '#F8FAFC' : 'var(--surface-hover)'
            }}
          >
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-base font-extrabold"
                style={{ color: scannerBoost ? '#091124' : 'var(--text-bright)' }}
              >
                {activeTicket.passengerName}
              </div>
              <div className="mt-0.5 font-mono text-[11px] opacity-70">
                TICKET: {activeTicket.ticketId.slice(0, 8).toUpperCase()}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleVerifySignature()}
                  disabled={verifying}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all"
                  style={{
                    backgroundColor: 'var(--brand-primary-subtle)',
                    color: 'var(--text-brand)',
                    border: '1px solid var(--brand-primary-border)'
                  }}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {verifying ? 'Checking...' : 'Verify Ed25519'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyToken()}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-semibold"
                  style={{
                    backgroundColor: scannerBoost ? '#E2E8F0' : 'var(--surface-card)',
                    color: scannerBoost ? '#1E293B' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'QR Token'}
                </button>
              </div>

              {verifyState && (
                <div
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] font-bold"
                  style={{
                    backgroundColor: verifyState.valid
                      ? 'var(--signal-emerald-subtle)'
                      : 'var(--danger-crimson-subtle)',
                    color: verifyState.valid
                      ? 'var(--signal-emerald)'
                      : 'var(--danger-crimson)'
                  }}
                >
                  {verifyState.valid ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      SIGNATURE VERIFIED · ACTIVE PASS
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      INVALID ({verifyState.reason})
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 12px Quiet-Zone Pure White Island for Optical Turnstile Scanners */}
            <div className="shrink-0 rounded-2xl bg-white p-3 shadow-md">
              {qrDataUrl ? (
                <button
            type="button"
            onClick={() =>
              setMaximizedQr({
                value: qrDataUrl,
                label: data?.pnr ? `PNR ${data.pnr} · ${data.flight.origin.iataCode} → ${data.flight.destination.iataCode}` : undefined
              })
            }
            title="Tap to maximize QR code"
            className="group flex flex-col items-center rounded-xl bg-white p-2 transition-transform hover:scale-[1.03] focus:outline-none"
          >
            <img
                  src={qrDataUrl}
                  alt={`Boarding Pass QR for ${activeTicket.passengerName}`}
                  className="h-28 w-28"
                />
            <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-sky-600">
              Tap to Maximize
            </span>
          </button>
              ) : (
                <div className="h-28 w-28 animate-pulse rounded bg-slate-200" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {maximizedQr && (
        <div
          onClick={() => setMaximizedQr(null)}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Maximized Boarding Pass QR Code"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col items-center rounded-3xl bg-white p-7 text-slate-950 shadow-2xl"
          >
            <div className="mb-1 font-mono text-[11px] font-extrabold uppercase tracking-widest text-sky-600">
              GATE OPTICAL BOOST
            </div>
            {maximizedQr.label && (
              <div className="text-center text-base font-extrabold text-slate-900">
                {maximizedQr.label}
              </div>
            )}
            <div className="my-5 rounded-2xl border-2 border-slate-200 bg-white p-4">
              <img src={maximizedQr.value} alt="Maximized Boarding Pass QR" className="h-64 w-64 object-contain" />
            </div>
            <p className="text-center font-mono text-[11px] text-slate-500">
              Hold steady 10–15 cm from optical gate scanner
            </p>
            <button
              type="button"
              onClick={() => setMaximizedQr(null)}
              className="mt-5 w-full rounded-xl bg-slate-900 py-3 text-xs font-extrabold text-white transition hover:bg-slate-800"
            >
              Close Full-Screen QR
            </button>
          </div>
        </div>
      )}
    </>
  );
}