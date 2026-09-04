'use client';

// components/sign-out-button.tsx
//
// The only way a customer can sign out. Before this there was none: only
// app/admin/layout.tsx linked to /api/auth/signout, which is NextAuth's
// unstyled default page and not somewhere a shopper should land.
//
// A CLIENT ISLAND, because signOut() is client-side and both of its homes
// -- the header and the profile page -- are server components.

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <button
      type="button"
      // Back to the shop rather than to a sign-in page: signing out is not
      // the start of signing in again.
      onClick={() => signOut({ callbackUrl: '/' })}
      // The header has room for an icon and not a word. The accessible
      // name still has to be there, or the only way out of the account is
      // invisible to a screen reader.
      aria-label={iconOnly ? 'Sign out' : undefined}
      className={
        iconOnly
          ? 'inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent'
          : 'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent'
      }
    >
      <LogOut aria-hidden="true" className="h-5 w-5" />
      {iconOnly ? null : 'Sign out'}
    </button>
  );
}
