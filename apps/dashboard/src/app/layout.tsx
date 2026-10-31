import { CompanyLanguageProvider, EnglishCompanyLanguage } from './company-language';
import { fetchAdminV2Pilot } from './lib';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'enTalent — Internal Pulse Dashboard',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = (await fetchAdminV2Pilot())?.companyLanguage ?? EnglishCompanyLanguage;
  return (
    <html lang={language.locale}>
      <body><CompanyLanguageProvider language={language}>{children}</CompanyLanguageProvider></body>
    </html>
  );
}
