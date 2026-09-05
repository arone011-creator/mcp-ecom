// tests/unit/sign-out-button.test.tsx
//
// Before this there was no way for a customer to sign out at all -- only
// the admin layout linked to NextAuth's unstyled default page.

jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));

import { fireEvent, render, screen } from '@testing-library/react';
import { signOut } from 'next-auth/react';

import { SignOutButton } from '@/components/sign-out-button';

const mockSignOut = signOut as unknown as jest.Mock;

beforeEach(() => mockSignOut.mockReset());

describe('SignOutButton', () => {
  it('sends the customer to the sign-in page', () => {
    // CHANGED 2026-09-05. It used to return to the shop, on the reasoning
    // that signing out is not the start of signing in again. In practice
    // that left a signed-out customer on a page that still looked signed
    // in, and the assistant's 401 was reported to them as "something went
    // wrong" -- so the way out of the account now ends somewhere that
    // says plainly what state they are in.
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/auth/signin' });
  });

  it('is reachable by its accessible name in the icon-only form', () => {
    // The header has room for an icon and not a word. Without the label
    // the only way out of the account is invisible to a screen reader.
    render(<SignOutButton iconOnly />);

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows the word when there is room for it', () => {
    render(<SignOutButton />);

    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });
});
