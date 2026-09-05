// tests/unit/tool-activity.test.tsx
//
// The activity chip, and what it offers when a call fails.
//
// THE MUST PROVE of M4 Task 6: "a failed tool call produces a visible
// failure with a way forward, not a stalled spinner." The event contract
// guarantees every started tool a completion, so a chip cannot spin
// forever; this is the half that makes the resolved state actionable.

import { fireEvent, render, screen } from '@testing-library/react';

import { ToolActivityChip } from '@/components/assistant/tool-activity';
import { toolLabel } from '@/lib/assistant/tool-labels';

const FAILED = {
  call_id: 'c1',
  tool: 'cancel_order',
  ok: false,
  error: 'That order has already been cancelled.',
};

describe('ToolActivityChip', () => {
  it('names the tool in customer words', () => {
    render(<ToolActivityChip activity={{ call_id: 'c1', tool: 'get_orders' }} />);

    expect(screen.getByText('Looking up your orders')).toBeInTheDocument();
  });

  it('shows the storefront own error message on a failure', () => {
    // Passed through every layer verbatim: it carries the fact that IS
    // available, and re-wording it here would be a second implementation
    // of somebody else's rule.
    render(<ToolActivityChip activity={FAILED} />);

    expect(
      screen.getByText('That order has already been cancelled.')
    ).toBeInTheDocument();
  });

  it('offers a way forward when a call failed', () => {
    // THE MUST PROVE.
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    render(
      <ToolActivityChip activity={FAILED} onRetry={onRetry} onDismiss={onDismiss} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('offers nothing on a call that succeeded', () => {
    const onRetry = jest.fn();
    render(
      <ToolActivityChip
        activity={{ call_id: 'c1', tool: 'get_orders', ok: true }}
        onRetry={onRetry}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers nothing on a call that is still working', () => {
    // The inverse of the MUST PROVE, and the reason a spinner is never a
    // dead end: a working call always resolves to done or failed, and
    // only the failed state offers a way out -- so there is no third
    // state where the customer is stuck with nothing to press.
    render(
      <ToolActivityChip
        activity={{ call_id: 'c1', tool: 'get_orders' }}
        onRetry={jest.fn()}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('offers nothing when no handlers were given', () => {
    // A stored transcript from last week shows its failures without
    // offering to re-run them.
    render(<ToolActivityChip activity={FAILED} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an error message as text, never as markup', () => {
    render(
      <ToolActivityChip
        activity={{ ...FAILED, error: '<img src=x onerror=alert(1)>' }}
      />
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('toolLabel', () => {
  it('names the specialists a request is handed to', () => {
    // The supervisor's tools ARE the specialists, so these arrive through
    // the same tool_started/tool_completed events as everything else. The
    // fallback would render "ask product", which is not wrong but reads
    // like a bug.
    expect(toolLabel('ask_product')).toBe('Asking the product specialist');
    expect(toolLabel('ask_order')).toBe('Asking the order specialist');
    expect(toolLabel('ask_cart')).toBe('Asking the cart specialist');
  });

  it('still shows an unlabelled tool honestly rather than hiding it', () => {
    // The fallback is why the storefront rendered multi-agent turns
    // correctly before these labels existed. It must stay.
    expect(toolLabel('ask_nobody')).toBe('ask nobody');
  });
});
