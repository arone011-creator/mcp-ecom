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
  it('signs out and returns the customer to the shop', () => {
    // Not to a sign-in page: signing out is not the start of signing in
    // again.
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/' });
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
