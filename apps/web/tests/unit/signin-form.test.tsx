// tests/unit/signin-form.test.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signIn } from 'next-auth/react';
import SignInForm from '@/app/auth/signin/signin-form';

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }));

const mockSignIn = signIn as jest.Mock;

// The seeded demo customer from prisma/seed.ts. If these drift, the
// one-click button silently stops working, so they are asserted here.
const DEMO_EMAIL = 'customer@example.com';
const DEMO_PASSWORD = 'demo1234';

describe('SignInForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignIn.mockResolvedValue({ ok: true, error: null });
  });

  it('offers a one-click demo login', () => {
    render(<SignInForm callbackUrl="/" />);
    expect(
      screen.getByRole('button', { name: /sign in as demo customer/i })
    ).toBeInTheDocument();
  });

  it('signs in with the seeded demo credentials on one click', async () => {
    render(<SignInForm callbackUrl="/orders" />);
    fireEvent.click(
      screen.getByRole('button', { name: /sign in as demo customer/i })
    );

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith('credentials', {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        callbackUrl: '/orders',
      })
    );
  });

  it('passes the caller-supplied callbackUrl through a manual sign-in', async () => {
    render(<SignInForm callbackUrl="/checkout" />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith('credentials', {
        email: 'someone@example.com',
        password: 'hunter2',
        callbackUrl: '/checkout',
      })
    );
  });

  it('surfaces an error when credentials are rejected', async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' });
    render(<SignInForm callbackUrl="/" />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalid email or password/i
    );
  });

  it('does not leave a stale error on screen after a later success', async () => {
    mockSignIn.mockResolvedValueOnce({ ok: false, error: 'CredentialsSignin' });
    render(<SignInForm callbackUrl="/" />);

    const submit = screen.getByRole('button', { name: /^sign in$/i });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    mockSignIn.mockResolvedValue({ ok: true, error: null });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
  });
});
