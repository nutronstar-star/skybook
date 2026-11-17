import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';
import { OtpAuthModal } from '@/components/OtpAuthModal';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap'
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'SkyBook — Flight Discovery, Live Seat Matrix & Cryptographic E-Tickets',
  description:
    'Dual-theme aviation booking portal with real-time WebSocket seat selection and Ed25519 signed e-boarding passes.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <AuthProvider>
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              <footer
                className="py-6 text-center font-mono text-xs"
                style={{
                  borderTop: '1px solid var(--border-hairline)',
                  color: 'var(--text-muted)'
                }}
              >
                SKYBOOK UNIFIED RESERVATION &amp; TELEMETRY ENGINE · DUAL-SPECTRUM UI
              </footer>
            </div>
            <OtpAuthModal />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}