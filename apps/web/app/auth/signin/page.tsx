// File: app/auth/signin/page.tsx
import { Metadata } from 'next';
import SignInForm from './signin-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your account, or use the one-click demo login.',
};

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;

  // Only accept a same-site relative path. An absolute URL arriving here
  // would turn the sign-in redirect into an open redirect.
  const safeCallbackUrl =
    callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
      ? callbackUrl
      : '/';

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-8 text-center text-3xl font-bold tracking-tight">
        Sign in
      </h1>
      <SignInForm callbackUrl={safeCallbackUrl} />
    </div>
  );
}
