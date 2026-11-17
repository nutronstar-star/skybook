import React from 'react';

interface SkyBookLogoProps {
  compact?: boolean;
  className?: string;
}

export function SkyBookLogo({ compact = false, className = '' }: SkyBookLogoProps) {
  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        viewBox="310 245 600 500"
        className="h-9 w-9 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sbSkyGradNav" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
        </defs>
        <path
          fill="var(--logo-navy)"
          fillRule="evenodd"
          d="M 410,275 L 790,275 C 825,275 850,300 850,335 L 850,515 A 28,28 0 0 0 850,571 L 850,655 C 850,690 825,715 790,715 L 410,715 C 375,715 350,690 350,655 L 350,571 A 28,28 0 0 0 350,515 L 350,335 C 350,300 375,275 410,275 Z
             M 435,345 C 415,345 402,358 402,378 L 402,485 L 798,485 L 798,378 C 798,358 785,345 765,345 Z
             M 402,595 L 402,632 C 402,650 415,662 435,662 L 765,662 C 785,662 798,650 798,632 L 798,595 Z"
        />
        <line
          x1="395"
          y1="543"
          x2="805"
          y2="543"
          stroke="var(--logo-sky)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray="18 22"
        />
        <path
          d="M 425,470 C 495,435 585,395 725,365"
          fill="none"
          stroke="url(#sbSkyGradNav)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray="20 20"
        />
        <circle cx="430" cy="468" r="14" fill="var(--logo-sky)" />
        <g transform="translate(755, 345) rotate(-32)">
          <path
            fill="url(#sbSkyGradNav)"
            d="M 92,0 C 106,0 116,8 116,16 C 116,24 106,32 92,32 L 36,32 L -14,94 L -36,94 L -8,32 L -56,32 L -74,56 L -90,56 L -78,16 L -90,-24 L -74,-24 L -56,0 L -8,0 L -36,-62 L -14,-62 L 36,0 Z"
          />
        </g>
        <circle cx="875" cy="272" r="14" fill="var(--logo-sky)" />
      </svg>

      {!compact && (
        <span className="text-xl font-extrabold tracking-tight leading-none">
          <span style={{ color: 'var(--logo-navy)' }}>Sky</span>
          <span style={{ color: 'var(--logo-sky)' }}>Book</span>
        </span>
      )}
    </div>
  );
}