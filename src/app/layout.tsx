import type { Metadata } from 'next';
import { Norican, Overlock } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';

const norican = Norican({
  weight: '400',
  variable: '--font-lb-display-loaded',
  subsets: ['latin'],
  display: 'swap',
});

const overlock = Overlock({
  weight: ['400', '700', '900'],
  variable: '--font-lb-body-loaded',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LoveByte — Send a feeling, not just a gift',
  description:
    'LoveByte turns your photos, voice notes, and words into a one-of-a-kind digital gift — a memory card game, a love letter, a quiz only they would know how to pass.',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${norican.variable} ${overlock.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
