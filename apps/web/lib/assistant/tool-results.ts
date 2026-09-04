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
  | {
      kind: 'cart';
      itemCount: number;
      subtotal: string | null;
      lines: CartLineCard[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 1;
}

/**
 * An image url, or null.
 *
 * AN ALLOWLIST OF TWO FORMS, not a search for bad ones. This url comes
 * out of product data an admin can edit, and a `javascript:` or `data:`
 * url in an <img src> is a rendering bug with teeth.
 *
 *   - an absolute http(s) url;
 *   - a site-relative path, which is what the seeded catalogue actually
 *     uses ("/images/products/macbook-air-m2.svg"). A single leading
 *     slash only: "//evil.example.com" is protocol-relative and points
 *     off this origin, which is the whole thing being guarded against.
 */
function imageUrl(value: unknown): string | null {
  const url = str(value);
  if (!url) return null;

  if (/^https?:\/\//i.test(url)) return url;

  return url.startsWith('/') && !url.startsWith('//') ? url : null;
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
      quantity: count(line.quantity),
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
        quantity: count(line.quantity),
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
      // AN ENVELOPE, NOT AN ARRAY: {products, pagination}. Verified
      // against the deployed app -- the first version of this read the
      // result as a bare list and rendered nothing at all, because a
      // fixture invented for this one tool happened to be wrong.
      const listed = isRecord(result) && Array.isArray(result.products)
        ? result.products
        : [];
      const products = listed
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
    //
    // cancel_order is DELIBERATELY ABSENT. It returns the raw response of
    // POST /cancel, whose shape has not been observed here, and a guess
    // that renders a card is worse than the chip alone -- which is what
    // an unmapped tool already gets.
    case 'get_order': {
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
