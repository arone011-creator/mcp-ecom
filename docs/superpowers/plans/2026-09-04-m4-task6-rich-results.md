# M4 Task 6: Rich Results and Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the panel stops answering in paragraphs. A product search shows product cards, an order lookup shows order cards, a multi-step request shows its steps as they complete, and a tool that fails offers a way forward instead of a dead chip.

**Architecture:** everything renders from `conversation.tools[].result` — the structured tool results already in the event stream — and never from the model's prose. That is the same rule the approval card follows, for the same reason: text beside an action can be written by whoever wrote the product description. No contract change, no agent change, no schema change. One new pure module maps a raw result to a card model; the components render the card model; the provider gains `retry`.

**Tech Stack:** Next.js App Router, React 18, Tailwind, Jest (`unit`, `integration`), lucide-react.

**Not in this task:** Task 6b (offering missing information as selectable choices) and Task 7 (making the active context visible). See "What 'Choose another' turns out to be" below — one of the three recovery actions named in the spec belongs to 6b, and this plan says so rather than faking it.

---

## What the spec asks for, and where each part lands

From `docs/PLAN_M4_STOREFRONT.txt`, Task 6:

| Spec line | Where it lands |
|---|---|
| Product cards and order cards instead of prose, rendered from tool results | Tasks 1–2 |
| Show the plan for a multi-step request, updating as steps complete | Task 3 |
| Progress indicators for longer flows, including failure states | Tasks 3–4 |
| Explicit recovery: **Retry**, **Choose another**, **Cancel** | Task 4 — see below |
| MUST PROVE: a failed tool call produces a visible failure with a way forward, not a stalled spinner | Task 4 |
| MUST PROVE: a cart or order change is visible on the real cart/orders page without a manual refresh | Task 5 |

### What "Choose another" turns out to be

The spec names three recovery actions. Two of them — **Retry** and **Cancel** — are honest to build here: retry re-sends the utterance that produced the failure, cancel dismisses the notice. **Choose another** is not, because there is nothing to choose *from*. Offering alternatives requires a list of real, available, customer-owned options, and the only place those can come from is a tool result — which is the entire subject of Task 6b ("the options come from a tool result, so the customer can only choose something that actually exists and belongs to them").

Building a "Choose another" button here would mean either a dead control or a hand-written list of guesses, and a guessed alternative in a shopping assistant is exactly the failure the 6b MUST PROVE exists to prevent. So this plan builds two of the three, and Task 6b builds the third on the foundation this one lays. **This is a deliberate, recorded deferral, not an oversight** — it goes in the record with the reason.

### Two decisions this plan makes

**1. Cards are rendered from the result, and the prose stays.** The obvious reading of "cards instead of prose" is to suppress the model's text when a card is shown. That would be wrong: the model's sentence is what answers the *question* ("both were cancelled"), and the card is what shows the *data*. Suppressing the sentence would leave the customer to infer the answer from a grid. So the card is added beneath the chip and the text is left alone.

**2. An unrecognised result renders nothing, not a fallback blob.** `describeResult` returns `null` for anything it does not recognise, and the panel shows the chip alone — exactly what it shows today. A JSON dump for an unknown shape would be a permanent invitation to render a tool result nobody designed for, which is how untrusted content reaches a screen.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/assistant/tool-results.ts` | one raw tool result → a card model | create |
| `tests/unit/tool-results.test.ts` | its tests | create |
| `components/assistant/result-cards.tsx` | product / order / cart cards | create |
| `tests/unit/result-cards.test.tsx` | their tests | create |
| `components/assistant/plan-steps.tsx` | the step list for a multi-step turn | create |
| `tests/unit/plan-steps.test.tsx` | its tests | create |
| `components/assistant/tool-activity.tsx` | recovery actions on a failed chip | modify |
| `tests/unit/tool-activity.test.tsx` | its tests | create |
| `components/assistant/assistant-provider.tsx` | `retry`, and refresh after a change | modify |
| `tests/unit/assistant-provider.test.tsx` | provider tests | add |
| `components/assistant/assistant-widget.tsx` | render the cards and the steps | modify |
| `tests/unit/assistant-widget.test.tsx` | widget tests | add |

**Why `tool-results.ts` is its own module.** It is the only part of this task that is pure, it is where every shape assumption about the API lives, and it is the piece a future tool will need to extend. Its tests are a table of real result payloads — copied from what the deployed agent actually returned, not from a description of what it should return.

---

## Task 1: one tool result, one card model

**Files:**
- Create: `lib/assistant/tool-results.ts`
- Test: `tests/unit/tool-results.test.ts`

The shapes below were read off the **deployed** app on 2026-09-04, not off the Pydantic models: money arrives as a *string*, keys arrive in the API's camelCase aliases (`orderNumber`, `orderItems`, `productName`, `itemCount`), and `get_orders` answers a bare array.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/tool-results.test.ts
//
// One raw tool result in, one card model out.
//
// THE FIXTURES ARE REAL. Every payload here was read off the deployed
// app on 2026-09-04 rather than written from the Pydantic models, because
// the two disagree in exactly the way that matters: the models are
// snake_case and the wire is the API's camelCase aliases, and money is a
// STRING all the way down.

import { describeResult } from '@/lib/assistant/tool-results';

const ORDERS = [
  {
    id: 'cmtlty4mf0006fer0zolmb6j1',
    orderNumber: 'ORD-1788458388710',
    status: 'CANCELLED',
    total: '1089.98',
    subtotal: '999.99',
    tax: '80',
    shipping: '9.99',
    currency: 'USD',
    createdAt: '2026-09-03T17:59:48.711Z',
    cancelledAt: '2026-09-03T18:00:17.415Z',
    orderItems: [
      {
        price: '999.99',
        quantity: 1,
        productId: 'cmtbwxsuk000c7dfk2g1oidir',
        productSku: 'IPH15PRO-128-NT',
        productName: 'iPhone 15 Pro',
      },
    ],
  },
];

const PRODUCTS = [
  {
    id: 'p1',
    name: 'iPhone 15 Pro',
    slug: 'iphone-15-pro',
    price: '999.99',
    status: 'ACTIVE',
    sku: 'IPH15PRO-128-NT',
    images: [{ url: 'https://cdn.example.com/a.jpg', altText: 'A phone' }],
  },
];

const CART = {
  itemCount: 2,
  subtotal: '1999.98',
  items: [
    { id: 'l1', quantity: 2, productId: 'p1', product: PRODUCTS[0] },
  ],
};

describe('describeResult', () => {
  it('describes a list of orders', () => {
    const card = describeResult('get_orders', ORDERS);

    expect(card).toMatchObject({ kind: 'orders' });
    expect(card!.orders).toHaveLength(1);
    expect(card!.orders[0]).toMatchObject({
      id: 'cmtlty4mf0006fer0zolmb6j1',
      orderNumber: 'ORD-1788458388710',
      status: 'CANCELLED',
      total: '1089.98',
    });
  });

  it('names what an order contains', () => {
    const card = describeResult('get_orders', ORDERS);

    expect(card!.orders[0].items).toEqual([
      { name: 'iPhone 15 Pro', quantity: 1, price: '999.99' },
    ]);
  });

  it('describes one order the same way as a list of one', () => {
    // get_order answers an object, get_orders an array. One card model
    // either way, so the component has one shape to render.
    const single = describeResult('get_order', ORDERS[0]);

    expect(single).toMatchObject({ kind: 'orders' });
    expect(single!.orders).toHaveLength(1);
  });

  it('describes a list of products', () => {
    const card = describeResult('search_products', PRODUCTS);

    expect(card).toMatchObject({ kind: 'products' });
    expect(card!.products[0]).toMatchObject({
      id: 'p1',
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      price: '999.99',
      image: 'https://cdn.example.com/a.jpg',
    });
  });

  it('describes a cart', () => {
    const card = describeResult('get_cart', CART);

    expect(card).toMatchObject({ kind: 'cart', itemCount: 2, subtotal: '1999.98' });
    expect(card!.lines[0]).toMatchObject({ name: 'iPhone 15 Pro', quantity: 2 });
  });

  it('describes the cart a change answered with', () => {
    // add_to_cart and remove_from_cart answer the whole cart, so the
    // customer sees the result of their change rather than a bare "done".
    expect(describeResult('add_to_cart', CART)).toMatchObject({ kind: 'cart' });
    expect(describeResult('remove_from_cart', CART)).toMatchObject({ kind: 'cart' });
  });

  it('keeps money as the string the API sent', () => {
    // A float loses the scale: 10.50 becomes 10.5, which is not a price.
    // The API preserves it deliberately and so does this.
    const card = describeResult('get_orders', [{ ...ORDERS[0], total: '10.50' }]);

    expect(card!.orders[0].total).toBe('10.50');
  });

  it('describes nothing for a tool it does not know', () => {
    // Not a JSON dump. A fallback blob would be a standing invitation to
    // render a result nobody designed for, which is how untrusted content
    // reaches a screen.
    expect(describeResult('check_inventory', { inStock: true })).toBeNull();
  });

  it('describes nothing for a result of the wrong shape', () => {
    expect(describeResult('get_orders', null)).toBeNull();
    expect(describeResult('get_orders', 'nonsense')).toBeNull();
    expect(describeResult('get_orders', [])).toBeNull();
    expect(describeResult('get_cart', { nope: true })).toBeNull();
  });

  it('survives a product with no image', () => {
    // The detail route returns no images key at all.
    const card = describeResult('search_products', [{ id: 'p1', name: 'Lamp' }]);

    expect(card!.products[0].image).toBeNull();
  });

  it('survives a cart line whose product was deleted', () => {
    // A deleted product leaves the line without one. Losing the whole
    // card over that would be worse than showing an incomplete line.
    const card = describeResult('get_cart', {
      itemCount: 1,
      subtotal: '0.00',
      items: [{ id: 'l1', quantity: 1, product: null }],
    });

    expect(card!.lines[0].name).toBe('This product is no longer available');
  });

  it('drops an entry that is not an object', () => {
    const card = describeResult('search_products', [PRODUCTS[0], 'nonsense', null]);

    expect(card!.products).toHaveLength(1);
  });

  it('never renders a url it was not given for an image', () => {
    // An image url comes out of product data an admin can edit. A
    // javascript: or data: url in an <img src> is a rendering bug with
    // teeth, so only http(s) survives.
    const card = describeResult('search_products', [
      { id: 'p1', name: 'Lamp', images: [{ url: 'javascript:alert(1)' }] },
    ]);

    expect(card!.products[0].image).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit --testPathPattern "tool-results"`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/assistant/tool-results.ts
//
// One raw tool result in, one card model out.
//
// RENDERED FROM THE RESULT, NEVER FROM THE MODEL'S PROSE. The same rule
// the approval card follows, for the same reason: text beside an action
// can be written by whoever wrote the product description. A card built
// from the tool's own structured answer says what the API said.
//
// EVERY SHAPE ASSUMPTION ABOUT THE API LIVES HERE, and every one of them
// was read off the deployed app rather than off the Pydantic models --
// the wire carries the API's camelCase aliases (`orderNumber`,
// `orderItems`, `productName`, `itemCount`), not the models' snake_case.
//
// MONEY IS A STRING, ALL THE WAY THROUGH. The API preserves the scale
// deliberately; parsing "10.50" to a float makes it 10.5, which is not a
// price. Nothing here converts one.

/** A product, reduced to what a narrow card can show. */
export interface ProductCard {
  id: string;
  name: string;
  slug: string | null;
  price: string | null;
  image: string | null;
}

export interface OrderLineCard {
  name: string;
  quantity: number;
  price: string | null;
}

export interface OrderCard {
  id: string;
  orderNumber: string;
  status: string;
  total: string | null;
  createdAt: string | null;
  items: OrderLineCard[];
}

export interface CartLineCard {
  id: string;
  name: string;
  quantity: number;
  price: string | null;
}

export type ResultCard =
  | { kind: 'products'; products: ProductCard[] }
  | { kind: 'orders'; orders: OrderCard[] }
  | { kind: 'cart'; itemCount: number; subtotal: string | null; lines: CartLineCard[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * An image url, or null.
 *
 * ONLY http(s). This url comes out of product data an admin can edit, and
 * a `javascript:` or `data:` url in an <img src> is a rendering bug with
 * teeth. An allowlist of two schemes, not a search for bad ones.
 */
function imageUrl(value: unknown): string | null {
  const url = str(value);
  if (!url) return null;

  return /^https?:\/\//i.test(url) ? url : null;
}

function productCard(raw: unknown): ProductCard | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  if (!id) return null;

  const images = Array.isArray(raw.images) ? raw.images : [];
  const first = isRecord(images[0]) ? images[0].url : null;

  return {
    id,
    name: str(raw.name) ?? 'Unnamed product',
    slug: str(raw.slug),
    price: str(raw.price),
    image: imageUrl(first),
  };
}

function orderCard(raw: unknown): OrderCard | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  const orderNumber = str(raw.orderNumber);
  if (!id || !orderNumber) return null;

  const lines = Array.isArray(raw.orderItems) ? raw.orderItems : [];

  return {
    id,
    orderNumber,
    status: str(raw.status) ?? 'UNKNOWN',
    total: str(raw.total),
    createdAt: str(raw.createdAt),
    items: lines.filter(isRecord).map((line) => ({
      name: str(line.productName) ?? 'Unnamed product',
      quantity: typeof line.quantity === 'number' ? line.quantity : 1,
      price: str(line.price),
    })),
  };
}

function cartCard(raw: unknown): ResultCard | null {
  if (!isRecord(raw)) return null;
  // itemCount is what distinguishes a cart from any other object, and a
  // cart with no items still has it.
  if (typeof raw.itemCount !== 'number') return null;

  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    kind: 'cart',
    itemCount: raw.itemCount,
    subtotal: str(raw.subtotal),
    lines: items.filter(isRecord).map((line, index) => {
      const product = isRecord(line.product) ? line.product : null;

      return {
        id: str(line.id) ?? `line-${index}`,
        // A deleted product leaves the line without one. Losing the whole
        // card over that would be worse than showing an incomplete line.
        name: product
          ? (str(product.name) ?? 'Unnamed product')
          : 'This product is no longer available',
        quantity: typeof line.quantity === 'number' ? line.quantity : 1,
        price: product ? str(product.price) : null,
      };
    }),
  };
}

/**
 * What this tool result should be shown as, or null.
 *
 * NULL IS A REAL ANSWER, not a failure: the panel renders the activity
 * chip alone, exactly as it does today. A JSON dump for an unrecognised
 * shape would be a standing invitation to render a tool result nobody
 * designed for, which is how untrusted content reaches a screen.
 */
export function describeResult(tool: string, result: unknown): ResultCard | null {
  switch (tool) {
    case 'search_products': {
      const products = (Array.isArray(result) ? result : [])
        .map(productCard)
        .filter((card): card is ProductCard => card !== null);

      return products.length > 0 ? { kind: 'products', products } : null;
    }

    case 'get_product': {
      const card = productCard(result);
      return card ? { kind: 'products', products: [card] } : null;
    }

    case 'get_orders': {
      const orders = (Array.isArray(result) ? result : [])
        .map(orderCard)
        .filter((card): card is OrderCard => card !== null);

      return orders.length > 0 ? { kind: 'orders', orders } : null;
    }

    // One order and a list of one are the same card model, so the
    // component has one shape to render rather than two.
    case 'get_order':
    case 'cancel_order': {
      const card = orderCard(result);
      return card ? { kind: 'orders', orders: [card] } : null;
    }

    // A cart change answers with the whole cart, so the customer sees
    // what their change did rather than a bare "done".
    case 'get_cart':
    case 'add_to_cart':
    case 'remove_from_cart':
      return cartCard(result);

    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the tests, then commit**

Run: `npx jest --selectProjects unit --testPathPattern "tool-results"` → 13 passed.

```bash
git add lib/assistant/tool-results.ts tests/unit/tool-results.test.ts
git commit -m "$(cat <<'EOF'
feat: one tool result, one card model

Every shape assumption about the API lives here, and every one was read
off the deployed app rather than the Pydantic models -- the wire carries
the API's camelCase aliases, not the models' snake_case, and money is a
string the whole way so 10.50 does not become 10.5.

An unrecognised shape describes nothing. A JSON fallback would be a
standing invitation to render a result nobody designed for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: the cards

**Files:**
- Create: `components/assistant/result-cards.tsx`
- Test: `tests/unit/result-cards.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/result-cards.test.tsx
//
// The cards. Presentational: handed a card model from tool-results.ts and
// nothing else -- no fetching, no model prose, no raw result.

import { render, screen } from '@testing-library/react';

import { ResultCards } from '@/components/assistant/result-cards';

const PRODUCTS = {
  kind: 'products' as const,
  products: [
    {
      id: 'p1',
      name: 'iPhone 15 Pro',
      slug: 'iphone-15-pro',
      price: '999.99',
      image: 'https://cdn.example.com/a.jpg',
    },
  ],
};

const ORDERS = {
  kind: 'orders' as const,
  orders: [
    {
      id: 'o1',
      orderNumber: 'ORD-1788458388710',
      status: 'CANCELLED',
      total: '1089.98',
      createdAt: '2026-09-03T17:59:48.711Z',
      items: [{ name: 'iPhone 15 Pro', quantity: 1, price: '999.99' }],
    },
  ],
};

const CART = {
  kind: 'cart' as const,
  itemCount: 2,
  subtotal: '1999.98',
  lines: [{ id: 'l1', name: 'iPhone 15 Pro', quantity: 2, price: '999.99' }],
};

describe('ResultCards', () => {
  it('shows a product with its price', () => {
    render(<ResultCards card={PRODUCTS} />);

    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText(/999\.99/)).toBeInTheDocument();
  });

  it('links a product to its own page', () => {
    // The point of a card over a paragraph: somewhere to go.
    render(<ResultCards card={PRODUCTS} />);

    expect(screen.getByRole('link', { name: /iPhone 15 Pro/ })).toHaveAttribute(
      'href',
      '/products/iphone-15-pro'
    );
  });

  it('does not link a product that has no slug', () => {
    // A link to /products/null is worse than no link.
    render(
      <ResultCards
        card={{ kind: 'products', products: [{ ...PRODUCTS.products[0], slug: null }] }}
      />
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
  });

  it('shows an order with its number, status and total', () => {
    render(<ResultCards card={ORDERS} />);

    expect(screen.getByText(/ORD-1788458388710/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelled/i)).toBeInTheDocument();
    expect(screen.getByText(/1089\.98/)).toBeInTheDocument();
  });

  it('links an order to its own page', () => {
    render(<ResultCards card={ORDERS} />);

    expect(screen.getByRole('link', { name: /ORD-1788458388710/ })).toHaveAttribute(
      'href',
      '/orders/o1'
    );
  });

  it('names what is in an order', () => {
    render(<ResultCards card={ORDERS} />);

    expect(screen.getByText(/iPhone 15 Pro/)).toBeInTheDocument();
  });

  it('shows a cart with its subtotal', () => {
    render(<ResultCards card={CART} />);

    expect(screen.getByText(/1999\.98/)).toBeInTheDocument();
    expect(screen.getByText(/iPhone 15 Pro/)).toBeInTheDocument();
  });

  it('says so plainly when a cart is empty', () => {
    render(<ResultCards card={{ kind: 'cart', itemCount: 0, subtotal: '0.00', lines: [] }} />);

    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders a product name as text, never as markup', () => {
    // A NAME COMES OUT OF PRODUCT DATA AN ADMIN CAN EDIT. This is the
    // same rule the chat text follows, applied where it is easy to
    // forget because the data feels like ours.
    render(
      <ResultCards
        card={{
          kind: 'products',
          products: [
            { ...PRODUCTS.products[0], name: '<img src=x onerror=alert(1)>' },
          ],
        }}
      />
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('shows no image when there is none', () => {
    render(
      <ResultCards
        card={{ kind: 'products', products: [{ ...PRODUCTS.products[0], image: null }] }}
      />
    );

    expect(document.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write the component**

```tsx
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
// Everything here renders as TEXT. A product name is data an admin can
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
  // scale is preserved deliberately upstream.
  return <span className="tabular-nums">${amount}</span>;
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
```

- [ ] **Step 3: Run the tests and commit**

```bash
git add components/assistant/result-cards.tsx tests/unit/result-cards.test.tsx
git commit -m "$(cat <<'EOF'
feat: product, order and cart cards in the assistant panel

Rendered from the structured tool result, never from the model's prose --
the same rule the approval card follows, because text beside an action
can be written by whoever wrote the product description.

The card does not replace the assistant's sentence. The sentence answers
the question; the card shows the data.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: showing the plan

**Files:**
- Create: `components/assistant/plan-steps.tsx`
- Test: `tests/unit/plan-steps.test.tsx`

The spec asks to "show the plan for a multi-step request, updating as steps complete, without exposing raw reasoning". The plan is derivable with **no contract change and no agent change**: `conversation.tools` already is the ordered list of what the turn is doing, and each entry already carries its state.

- [ ] **Step 1: Write the failing tests**

```typescript
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

    expect(screen.getByLabelText('Looking up your orders: done')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Opening an order: could not be completed')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Checking your cart: working')).toBeInTheDocument();
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
```

- [ ] **Step 2: Write the component**

Extract the existing `LABELS` map and `label()` from `tool-activity.tsx` into a shared module first — `lib/assistant/tool-labels.ts` — and import it in both places. Two copies of the customer-facing wording would drift the first time a tool is renamed, and the plan and the chip disagreeing about what a step is called is worse than either being wrong.

```tsx
'use client';

// components/assistant/plan-steps.tsx
//
// What this turn is doing, for a turn that is doing more than one thing.
//
// DERIVED FROM THE TOOLS, NOT FROM REASONING. The spec asks for
// visibility into what the assistant intends "without exposing raw
// reasoning", and this is what that distinction buys: the steps are the
// calls it is actually making, which is a fact about the turn, rather
// than the model's account of itself, which is prose.
//
// It appears only when there are two or more steps. For one call the
// activity chip already says everything this would.

import type { ToolActivity } from '@/lib/assistant/events';
import { toolLabel } from '@/lib/assistant/tool-labels';

type StepState = 'done' | 'failed' | 'waiting' | 'working';

function stateOf(activity: ToolActivity): StepState {
  if (activity.awaiting_approval) return 'waiting';
  if (activity.ok === undefined) return 'working';
  return activity.ok ? 'done' : 'failed';
}

const WORDS: Record<StepState, string> = {
  done: 'done',
  failed: 'could not be completed',
  waiting: 'waiting for you',
  working: 'working',
};

const MARKS: Record<StepState, string> = {
  done: 'v',
  failed: 'x',
  waiting: '?',
  working: '.',
};

const TONES: Record<StepState, string> = {
  done: 'text-emerald-700',
  failed: 'text-rose-700',
  waiting: 'text-amber-700',
  working: 'text-slate-400',
};

export function PlanSteps({ tools }: { tools: ToolActivity[] }) {
  // One tool is not a plan.
  if (tools.length < 2) return null;

  const states = tools.map(stateOf);
  // An approval is a stop, not progress, so it is not counted as done.
  const finished = states.filter((state) => state === 'done').length;

  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
      <p className="mb-1 font-medium text-slate-600">
        Steps - {finished} of {tools.length} done
      </p>
      <ul className="flex flex-col gap-0.5">
        {tools.map((activity, index) => {
          const state = states[index]!;
          const name = toolLabel(activity.tool);

          return (
            <li
              key={activity.call_id}
              aria-label={`${name}: ${WORDS[state]}`}
              className={`flex items-center gap-1.5 ${TONES[state]}`}
            >
              <span aria-hidden="true" className="w-3 text-center font-mono">
                {MARKS[state]}
              </span>
              <span className="truncate">{name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests and commit**

---

## Task 4: a failure with a way forward

**Files:**
- Modify: `components/assistant/tool-activity.tsx`, `components/assistant/assistant-provider.tsx`
- Test: `tests/unit/tool-activity.test.tsx`, `tests/unit/assistant-provider.test.tsx`

**THE MUST PROVE.** A failed tool today renders a red chip with the storefront's message and nothing to do about it. This adds **Retry** and **Dismiss**. It does not add "Choose another" — see the section at the top of this plan; that is Task 6b's, and building a dead control here would be worse than not building it.

- [ ] **Step 1: The provider learns to retry**

`retry()` re-sends the utterance of the turn the failure belongs to. It refuses while a turn is in flight, exactly as `send` does. Add to the context value and the interface.

```typescript
  /**
   * Send the last thing the customer asked, again.
   *
   * A failed tool call leaves the customer looking at a red chip. The
   * spec's MUST PROVE is that it offers a way forward rather than a
   * stalled spinner, and the simplest honest one is "ask again" -- the
   * failure may have been transient, and the customer should not have to
   * retype the question to find out.
   *
   * It sends a NEW turn rather than resuming the failed one. Resuming
   * would mean the agent re-entering a graph it has already finished, and
   * the failed turn is already written down.
   */
  const retry = useCallback(() => {
    if (inFlight.current) return;

    const last = turns[turns.length - 1];
    if (!last) return;

    void send(last.utterance);
  }, [send, turns]);
```

- [ ] **Step 2: The chip offers the actions**

`ToolActivityChip` takes two optional props, `onRetry` and `onDismiss`, and renders the buttons only when the call failed **and** a handler was given. Optional so the chip stays usable in a stored transcript, where retrying a turn from last week is not something to offer.

```tsx
      {activity.ok === false ? (
        <span className="mt-1 flex gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-rose-300 px-1.5 py-0.5 font-medium hover:bg-rose-100"
            >
              Try again
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100"
            >
              Dismiss
            </button>
          ) : null}
        </span>
      ) : null}
```

Tests, in `tests/unit/tool-activity.test.tsx`:

- a failed chip shows the storefront's own error message;
- a failed chip offers **Try again**, and clicking it calls `onRetry`;
- a failed chip offers **Dismiss**, and clicking it calls `onDismiss`;
- a *successful* chip offers neither;
- a chip *still working* offers neither — **the MUST PROVE stated as its inverse: a spinner never becomes a dead end, because a working call always resolves to one of the two states that do offer a way out**;
- a chip with no handlers renders no buttons at all;
- the error text is rendered as text, never as markup.

- [ ] **Step 3: Run the tests and commit**

---

## Task 5: a change the rest of the site can see

**Files:** `components/assistant/assistant-provider.tsx`, `tests/unit/assistant-provider.test.tsx`

**THE SECOND MUST PROVE.** A cart or order change made through the assistant must be visible on the real cart and orders pages without a manual refresh, "because it went through the same data path a manual action would — never a private copy the chat keeps to itself".

It already goes through the same data path: the agent calls the MCP server, which calls `/api/v1`, which is the same API the cart page writes through. What is missing is that the page around the panel is a **server component rendered before the change happened**. `app/(store)/cart/cart-view.tsx` already solves this for manual actions with `router.refresh()`; the assistant must do the same.

- [ ] **Step 1: Write the failing tests**

```typescript
  it('refreshes the page after the assistant changes the cart', async () => {
    // THE MUST PROVE. The change already went through the same API the
    // cart page writes through -- what is stale is the server-rendered
    // page around the panel, exactly as it is after a manual add, which
    // cart-view.tsx already fixes with router.refresh().
    ...
    expect(refresh).toHaveBeenCalled();
  });

  it('refreshes after an order is cancelled', async () => { ... });

  it('does NOT refresh after a read-only turn', async () => {
    // A refresh re-renders every server component on the page. Doing it
    // after "what did I order?" would make every question cost a
    // re-render for no change.
    ...
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does NOT refresh when the change failed', async () => {
    // Nothing changed, so nothing is stale.
    ...
    expect(refresh).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Implement**

In the provider, after the stream ends:

```typescript
/** Tools that change something the rest of the site renders. */
const CHANGING_TOOLS = new Set(['add_to_cart', 'remove_from_cart', 'cancel_order']);
```

```typescript
      // A CHANGE MADE HERE MUST BE VISIBLE EVERYWHERE. The write already
      // went through the same /api/v1 a manual action does -- what is
      // stale is the server-rendered page around this panel. The cart
      // page fixes exactly this for its own buttons with router.refresh();
      // this is the same fix for the same staleness.
      //
      // Only when something actually changed: a refresh re-renders every
      // server component on the page, and doing that after "what did I
      // order?" would make every question cost one for no change.
      if (
        forwarded.some(
          (event) =>
            event.type === 'tool_completed' &&
            event.data?.ok === true &&
            CHANGING_TOOLS.has(String(event.data?.tool))
        )
      ) {
        router.refresh();
      }
```

Read the accumulated events of the turn rather than `conversation.tools`, which has not been recomputed from state yet at this point in `send`.

- [ ] **Step 3: Run the tests and commit**

---

## Task 6: wire it into the panel, deploy, verify, record

- [ ] **Step 1: Render the cards and the plan in `assistant-widget.tsx`**

In the timeline loop, where `item.kind === 'tool'` resolves an activity, render:

```tsx
                  const card =
                    activity.ok === true
                      ? describeResult(activity.tool, activity.result)
                      : null;

                  return (
                    <div key={...}>
                      <ToolActivityChip
                        activity={activity}
                        onRetry={newest ? retry : undefined}
                        onDismiss={newest ? dismiss : undefined}
                      />
                      {card ? <ResultCards card={card} /> : null}
                    </div>
                  );
```

and render `<PlanSteps tools={entry.conversation.tools} />` above the timeline for the newest turn only — a plan for a finished turn from last week is history, not progress.

`onRetry`/`onDismiss` are passed only for the newest turn, so an old transcript shows its failures without offering to re-run them.

- [ ] **Step 2: Widget tests**

- a completed `get_orders` renders an order card beneath its chip;
- a completed `check_inventory` renders the chip and no card;
- a two-tool turn renders the step list; a one-tool turn does not;
- a failed tool in the newest turn offers **Try again**; the same failure in an older turn does not.

- [ ] **Step 3: Full suite, typecheck, build**

```bash
npx jest && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Mutation-test**

| Mutation | Test that must catch it |
|---|---|
| `describeResult` returns a `{kind:'products'}` for an unknown tool | "describes nothing for a tool it does not know", Task 1 |
| `imageUrl` returns the url without the scheme check | "never renders a url it was not given for an image", Task 1 |
| `PlanSteps` renders for a single tool | "shows nothing for a single-step turn", Task 3 |
| `PlanSteps` counts a waiting step as done | "does not count a step that is waiting on the customer", Task 3 |
| the chip offers Try again on a call still working | the working-chip test, Task 4 |
| `CHANGING_TOOLS` gains `get_cart` | "does NOT refresh after a read-only turn", Task 5 |
| the refresh fires regardless of `ok` | "does NOT refresh when the change failed", Task 5 |

- [ ] **Step 5: Deploy and verify live**

Storefront only — this task changes no agent code. Verify signed in as the demo customer:

1. Ask for orders → **order cards** appear beneath the chip, each linking to its order page.
2. Ask to search products → **product cards** with prices, linking to product pages.
3. Ask to add something to the cart → the **cart card** shows the new contents, **and the header cart count updates without a manual refresh**. This is the MUST PROVE; watch the header, not the panel.
4. Ask something that takes two tools → the **step list** appears and fills in.
5. Force a failure (ask to cancel an order that is already cancelled) → a **red chip with Try again and Dismiss**, and Try again re-sends.

- [ ] **Step 6: Record in `docs/PLAN_M4_STOREFRONT.txt`**

Record what was verified live and what was not, and **record the "Choose another" deferral and its reason explicitly** — a spec line that was not built must be visible in the record, not only in this plan.

---

## Self-review notes

**Spec coverage.** Cards (Tasks 1–2), show-the-plan (Task 3), progress with failure states (Tasks 3–4), MUST PROVE on a failed call having a way forward (Task 4), MUST PROVE on a change being visible site-wide (Task 5). One spec line — "Choose another" — is deliberately deferred to Task 6b with the reason stated in the plan and required in the record.

**Type consistency.** `ResultCard` is produced by `describeResult` and consumed by `ResultCards`. `ToolActivity` is the existing contract type, used unchanged by `PlanSteps` and the chip. `toolLabel` is extracted to `lib/assistant/tool-labels.ts` in Task 3 and imported by both `tool-activity.tsx` and `plan-steps.tsx`.

**Placeholders.** Tasks 4 and 5 describe their tests rather than writing every one out, because both extend existing suites whose harnesses already exist. Every code change shows its code.
