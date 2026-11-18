'use client';

import React, { useEffect, useRef, useState } from 'react';

interface BarcodeDetection {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<BarcodeDetection[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
}

export function QrCameraScanner({
  onScan
}: {
  onScan: (payload: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!scanning) return;

    const Detector = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;

    if (!Detector) {
      setError(
        'Live QR detection requires Chrome, Edge, or Android WebView. Use manual paste below on this browser.'
      );
      stopCamera();
      return;
    }

    const detector = new Detector({ formats: ['qr_code'] });
    let cancelled = false;

    const interval = setInterval(async () => {
      if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
        return;
      }
      try {
        const codes = await detector.detect(videoRef.current);
        const match = codes.find((c) => c.rawValue?.trim());
        if (match && !cancelled) {
          onScan(match.rawValue.trim());
          stopCamera();
        }
      } catch {
        // Ignore transient frame read errors
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scanning, onScan]);

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API unavailable in this browser context.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Camera access denied: ${err.message}`
          : 'Unable to access camera.'
      );
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-500/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-wider opacity-80">
          Optical Gate Scanner (Webcam / Mobile)
        </span>
        {!scanning ? (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-400"
          >
            Scan QR with Camera
          </button>
        ) : (
          <button
            type="button"
            onClick={stopCamera}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-400"
          >
            Stop Camera
          </button>
        )}
      </div>

      {scanning && (
        <div className="relative mt-3 overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="mx-auto max-h-64 w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-xl border-2 border-sky-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 font-mono text-xs text-rose-400">{error}</p>
      )}
    </div>
  );
}
