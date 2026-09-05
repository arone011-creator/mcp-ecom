// tests/unit/assistant-signed-out.test.tsx
//
// WHAT A SIGNED-OUT VISITOR SEES: nothing of the assistant at all.
//
// Found live. After signing out, the shop still showed the floating
// assistant button, and pressing it produced "Something went wrong
// reaching the assistant. Try again." -- which was a 401 from the bridge
// route reported as a transport failure. Retrying could never work. The
// button offered a capability the visitor did not have, and then blamed
// the network for it.
//
// Two halves, and the second matters as much as the first: the provider
// must also stop ASKING. A signed-out page load was firing two requests
// that could only ever be 401s.

const mockUseSession = jest.fn();

jest.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

import { render, screen, waitFor } from '@testing-library/react';

import { AssistantProvider } from '@/components/assistant/assistant-provider';
import { AssistantWidget } from '@/components/assistant/assistant-widget';

const originalFetch = global.fetch;

function signedIn() {
  mockUseSession.mockReturnValue({
    data: { user: { email: 'customer@example.com' } },
    status: 'authenticated',
  });
}

function signedOut() {
  mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { conversations: [] } }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('the assistant when nobody is signed in', () => {
  it('offers no way to open it', () => {
    // THE MUST PROVE. A control that can only fail is worse than no
    // control: it reads as the shop being broken rather than as the
    // visitor being signed out.
    signedOut();

    render(
      <AssistantProvider>
        <AssistantWidget />
      </AssistantProvider>
    );

    expect(screen.queryByRole('button', { name: /assistant/i })).toBeNull();
  });

  it('asks the server for nothing', async () => {
    // The signed-out page load used to fire /conversations and
    // /conversations/latest, and both could only ever answer 401.
    signedOut();

    render(
      <AssistantProvider>
        <AssistantWidget />
      </AssistantProvider>
    );

    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });
});

describe('the assistant when a customer is signed in', () => {
  it('still offers the button', () => {
    // The other half: hiding it from everyone would be a simpler fix and
    // the wrong one.
    signedIn();

    render(
      <AssistantProvider>
        <AssistantWidget />
      </AssistantProvider>
    );

    expect(
      screen.getByRole('button', { name: /assistant/i })
    ).toBeInTheDocument();
  });

  it('resumes the conversation as it always did', async () => {
    signedIn();

    render(
      <AssistantProvider>
        <AssistantWidget />
      </AssistantProvider>
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });
});
