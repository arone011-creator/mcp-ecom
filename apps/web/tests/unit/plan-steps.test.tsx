// tests/unit/plan-steps.test.tsx
//
// The plan, for a turn that has one. Derived from the tools the turn is
// actually running -- NOT from the model's reasoning, which is neither
// available here nor something to put on a customer's screen.

import { render, screen } from '@testing-library/react';

import { PlanSteps } from '@/components/assistant/plan-steps';

const WORKING = [
  { call_id: 'c1', tool: 'get_orders', ok: true },
  { call_id: 'c2', tool: 'get_order' },
];

describe('PlanSteps', () => {
  it('shows nothing for a single-step turn', () => {
    // One tool is not a plan; the chip already says what is happening.
    const { container } = render(
      <PlanSteps tools={[{ call_id: 'c1', tool: 'get_orders' }]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for a turn with no tools at all', () => {
    const { container } = render(<PlanSteps tools={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names each step in customer words', () => {
    render(<PlanSteps tools={WORKING} />);

    expect(screen.getByText('Looking up your orders')).toBeInTheDocument();
    expect(screen.getByText('Opening an order')).toBeInTheDocument();
  });

  it('counts the steps that are done', () => {
    render(<PlanSteps tools={WORKING} />);

    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('marks a finished step, a working step and a failed one differently', () => {
    render(
      <PlanSteps
        tools={[
          { call_id: 'c1', tool: 'get_orders', ok: true },
          { call_id: 'c2', tool: 'get_order', ok: false, error: 'nope' },
          { call_id: 'c3', tool: 'get_cart' },
        ]}
      />
    );

    expect(
      screen.getByLabelText('Looking up your orders: done')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Opening an order: could not be completed')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Checking your cart: working')
    ).toBeInTheDocument();
  });

  it('does not count a step that is waiting on the customer', () => {
    // An approval is not progress; it is a stop.
    render(
      <PlanSteps
        tools={[
          { call_id: 'c1', tool: 'get_orders', ok: true },
          { call_id: 'c2', tool: 'cancel_order', awaiting_approval: true },
        ]}
      />
    );

    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(
      screen.getByLabelText('Cancelling an order: waiting for you')
    ).toBeInTheDocument();
  });
});
