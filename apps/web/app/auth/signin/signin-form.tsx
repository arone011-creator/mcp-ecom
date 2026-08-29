// File: app/auth/signin/signin-form.tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// The demo customer seeded by prisma/seed.ts. The one-click button exists
// so a visitor can reach the order flow without inventing an account;
// there is no real payment behind it.
const DEMO_EMAIL = 'customer@example.com';
const DEMO_PASSWORD = 'demo1234';

export default function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function attempt(nextEmail: string, nextPassword: string) {
    setPending(true);
    setError(null);

    const result = await signIn('credentials', {
      email: nextEmail,
      password: nextPassword,
      callbackUrl,
    });

    // A successful credentials sign-in normally navigates away, so this
    // only matters on failure -- but clearing the error first means a
    // later success does not leave a stale message on screen.
    if (result && !result.ok) {
      setError('Invalid email or password.');
    }
    setPending(false);
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <Button
        type="button"
        className="w-full"
        disabled={pending}
        onClick={() => attempt(DEMO_EMAIL, DEMO_PASSWORD)}
      >
        Sign in as demo customer
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        or use your own credentials
      </p>

      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          void attempt(email, password);
        }}
      >
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" variant="outline" className="w-full" disabled={pending}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
