// tests/unit/assistant-conversation-list.test.tsx
//
// The history view. A presentational component: it is handed the chats
// and three callbacks, and owns exactly one piece of state -- which row
// is armed for deletion.

import { fireEvent, render, screen } from '@testing-library/react';

import { ConversationList } from '@/components/assistant/conversation-list';

const CHATS = [
  {
    id: 'conv_2',
    name: 'Cancelling an order',
    lastTurnAt: '2026-09-04T11:00:00.000Z',
  },
  {
    id: 'conv_1',
    name: 'what did I order?',
    lastTurnAt: '2026-09-03T09:00:00.000Z',
  },
];

const NOW = new Date('2026-09-04T12:00:00.000Z');

function renderList(
  overrides: Partial<React.ComponentProps<typeof ConversationList>> = {}
) {
  const onOpen = jest.fn();
  const onDelete = jest.fn();

  render(
    <ConversationList
      conversations={CHATS}
      openId="conv_2"
      onOpen={onOpen}
      onDelete={onDelete}
      now={NOW}
      {...overrides}
    />
  );

  return { onOpen, onDelete };
}

describe('ConversationList', () => {
  it('lists every chat by name', () => {
    renderList();

    expect(screen.getByText('Cancelling an order')).toBeInTheDocument();
    expect(screen.getByText('what did I order?')).toBeInTheDocument();
  });

  it('says how long ago each one was', () => {
    renderList();

    expect(screen.getByText('1h ago')).toBeInTheDocument();
    expect(screen.getByText('1d ago')).toBeInTheDocument();
  });

  it('opens a chat when its row is clicked', () => {
    const { onOpen } = renderList();

    fireEvent.click(screen.getByText('what did I order?'));

    expect(onOpen).toHaveBeenCalledWith('conv_1');
  });

  it('tells the customer which chat they are in', () => {
    renderList();

    expect(
      screen.getByRole('button', { name: 'Open Cancelling an order' })
    ).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByRole('button', { name: 'Open what did I order?' })
    ).not.toHaveAttribute('aria-current', 'true');
  });

  it('says so plainly when there are no chats yet', () => {
    renderList({ conversations: [] });

    expect(screen.getByText(/No chats yet/i)).toBeInTheDocument();
  });

  it('does NOT delete on the first click', () => {
    // THE MUST PROVE. One stray click must not destroy a conversation.
    const { onDelete } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Delete what did I order?' }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('asks for confirmation, then deletes on the second click', () => {
    const { onDelete } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Delete what did I order?' }));

    const confirm = screen.getByRole('button', {
      name: 'Confirm deleting what did I order?',
    });
    expect(confirm).toBeInTheDocument();

    fireEvent.click(confirm);

    expect(onDelete).toHaveBeenCalledWith('conv_1');
  });

  it('lets the customer back out of a delete', () => {
    const { onDelete } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Delete what did I order?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep what did I order?' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', {
        name: 'Confirm deleting what did I order?',
      })
    ).not.toBeInTheDocument();
  });

  it('arms only one row at a time', () => {
    // Arming a second row while the first is armed would leave two live
    // confirm buttons on screen, either of which destroys something.
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Delete what did I order?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cancelling an order' }));

    expect(
      screen.queryByRole('button', {
        name: 'Confirm deleting what did I order?',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Confirm deleting Cancelling an order',
      })
    ).toBeInTheDocument();
  });

  it('does not open a chat when its delete button is clicked', () => {
    // The delete button sits inside the row. Without stopping the event
    // it would arm the delete AND switch chats in one click.
    const { onOpen } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Delete what did I order?' }));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a name as text, never as markup', () => {
    // A name is the customer's own first message today, and a
    // model-written title from Phase 4 tomorrow. Neither is markup.
    renderList({
      conversations: [
        {
          id: 'conv_x',
          name: '<img src=x onerror=alert(1)>',
          lastTurnAt: NOW.toISOString(),
        },
      ],
    });

    expect(
      screen.getByText('<img src=x onerror=alert(1)>')
    ).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
