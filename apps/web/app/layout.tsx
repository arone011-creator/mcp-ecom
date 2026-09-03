// File: app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AssistantWidget } from '@/components/assistant/assistant-widget';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'NextJS E-commerce Store',
    template: '%s | NextJS E-commerce',
  },
  description: 'Modern e-commerce store built with Next.js, Prisma, and Stripe',
  keywords: ['ecommerce', 'nextjs', 'store', 'shopping'],
  authors: [{ name: 'NextJS E-commerce' }],
  creator: 'NextJS E-commerce',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  ),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    title: 'NextJS E-commerce Store',
    description: 'Modern e-commerce store built with Next.js',
    siteName: 'NextJS E-commerce',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NextJS E-commerce Store',
    description: 'Modern e-commerce store built with Next.js',
    creator: '@nextjsecommerce',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        {/*
          The assistant is mounted HERE, above the page, and that
          placement is the feature: a client-side navigation re-renders
          children and leaves the conversation and its open connection
          untouched. Mounted inside a page it would reset every time a
          customer clicked a product.

          It sits inside <Providers>, which ALREADY supplies CartProvider
          -- so a cart change made through the chat reaches the same
          context the header badge reads, never a private copy (storefront
          plan, section 3, rule 3).

          Task 4 wrapped a SECOND CartProvider around this to get that
          nesting, not noticing Providers had one. Two instances each held
          their own items state and each synced the same localStorage
          'cart' key, so they could overwrite one another -- and the outer
          one had no consumers at all, since everything below lived inside
          the inner. Exactly the private-copy failure the comment claimed
          to prevent.
        */}
        <Providers>
          <AssistantProvider>
            <div className="flex min-h-screen flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <AssistantWidget />
            <Toaster />
          </AssistantProvider>
        </Providers>
      </body>
    </html>
  );
}
