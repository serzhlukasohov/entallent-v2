import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'enTalent — Manager Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
