import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/context/ThemeContext';
import { AdminAuthProvider } from '@/context/AdminAuthContext';
import { AdminNavbar } from '@/components/AdminNavbar';

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
  title: 'SkyBook Admin Console — Flight Operations, PII Oversight & Revenue Analytics',
  description: 'Operator console for managing flight lifecycle, audited PII unmasking, and refund approvals.'
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
          <AdminAuthProvider>
            <div className="flex min-h-screen flex-col">
              <AdminNavbar />
              <main className="flex-1">{children}</main>
              <footer
                className="py-6 text-center font-mono text-xs"
                style={{
                  borderTop: '1px solid var(--border-hairline)',
                  color: 'var(--text-muted)'
                }}
              >
                SKYBOOK OPERATIONS &amp; COMPLIANCE CONSOLE · ISO/IEC 27001 AUDIT READY
              </footer>
            </div>
          </AdminAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}