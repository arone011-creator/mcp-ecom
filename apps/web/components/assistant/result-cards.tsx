'use client';

// components/assistant/result-cards.tsx
//
// What a tool actually found, as cards.
//
// PRESENTATIONAL, and handed a card model rather than a raw result: the
// mapping lives in lib/assistant/tool-results.ts, so every shape
// assumption about the API is in one place and this file is only about
// rendering.
//
// THE CARD DOES NOT REPLACE THE ASSISTANT'S SENTENCE. The sentence
// answers the question ("both were cancelled"); the card shows the data.
// Suppressing the prose would leave the customer to infer an answer from
// a grid.
//
// EVERYTHING HERE RENDERS AS TEXT. A product name is data an admin can
// edit, and the fact that it feels like our own data is exactly why the
// rule is easy to forget here.

import Link from 'next/link';

import type { ResultCard } from '@/lib/assistant/tool-results';

/** "CANCELLED" is a database value. "Cancelled" is a word. */
function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function Money({ amount }: { amount: string | null }) {
  if (!amount) return null;

  // The string the API sent, with a symbol in front. Never parsed: the
  // scale is preserved deliberately upstream, and 10.50 is not 10.5.
  return <span className="shrink-0 tabular-nums">${amount}</span>;
}

export function ResultCards({ card }: { card: ResultCard }) {
  if (card.kind === 'products') {
    return (
      <ul className="mt-1 flex flex-col gap-1" aria-label="Products found">
        {card.products.map((product) => {
          const body = (
            <span className="flex items-center gap-2">
              {product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.image}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded object-cover"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{product.name}</span>
              <Money amount={product.price} />
            </span>
          );

          return (
            <li
              key={product.id}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
            >
              {/* A link to /products/null is worse than no link. */}
              {product.slug ? (
                <Link href={`/products/${product.slug}`} className="block">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (card.kind === 'orders') {
    return (
      <ul className="mt-1 flex flex-col gap-1" aria-label="Orders">
        {card.orders.map((order) => (
          <li
            key={order.id}
            className="rounded border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
          >
            <Link href={`/orders/${order.id}`} className="block">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{order.orderNumber}</span>
                <Money amount={order.total} />
              </span>
              <span className="mt-0.5 block text-slate-500">
                {statusLabel(order.status)}
                {order.items.length > 0
                  ? ` - ${order.items
                      .map((line) => `${line.quantity} x ${line.name}`)
                      .join(', ')}`
                  : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (card.lines.length === 0) {
    return <p className="mt-1 text-xs text-slate-500">Your cart is empty.</p>;
  }

  return (
    <div className="mt-1 rounded border border-slate-200 px-2 py-1.5 text-xs">
      <ul className="flex flex-col gap-0.5" aria-label="Your cart">
        {card.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate">
              {line.quantity} x {line.name}
            </span>
            <Money amount={line.price} />
          </li>
        ))}
      </ul>
      <p className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
        <span>Subtotal</span>
        <Money amount={card.subtotal} />
      </p>
    </div>
  );
}
