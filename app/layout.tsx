import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Roove BI Dashboard',
  description: 'Business Intelligence Dashboard for Roove',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
