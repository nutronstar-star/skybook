import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <div
        className="w-full rounded-3xl p-8"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-ambient)'
        }}
      >
        <div
          className="font-mono text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--telemetry-cyan)' }}
        >
          404 · FLIGHT CORRIDOR NOT FOUND
        </div>
        <h1 className="mt-2 text-2xl font-extrabold" style={{ color: 'var(--text-bright)' }}>
          This Route Isn&apos;t on Our Radar
        </h1>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          The itinerary, flight sector, or boarding pass link may have expired or moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl px-6 py-3 text-xs font-extrabold"
          style={{
            backgroundColor: 'var(--brand-primary)',
            color: 'var(--text-inverse)'
          }}
        >
          Return to Flight Search
        </Link>
      </div>
    </div>
  );
}