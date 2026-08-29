// app/api/v1/_lib/product-view.ts
//
// The queries behind the product routes select whole Product rows, which
// carry fields a stranger has no business seeing -- costPrice is the
// margin on every item, and trackQuantity and barcode are operational
// detail. The storefront gets away with it because it renders on the
// server and never ships the row; an API hands the row straight over.
//
// An allowlist rather than a denylist: a field added to the schema later
// stays private until someone deliberately publishes it.

const PUBLIC_PRODUCT_FIELDS = [
  'id',
  'name',
  'slug',
  'description',
  'content',
  'price',
  'comparePrice',
  'weight',
  'status',
  'sku',
  'tags',
  'seoTitle',
  'seoDescription',
  'categoryId',
  'createdAt',
  'updatedAt',
  // Relations, included only when the calling query asked for them.
  'category',
  'images',
  'variants',
] as const;

// The routes behind this view disagreed about the type of a price.
// searchProducts converts Decimal to Number for the storefront, which
// renders it and does arithmetic on it, so the list endpoint emitted
// `999.99`; getProductById does not convert, so the Decimal reached
// respond.ts and the detail endpoint emitted `"999.99"`. Same product,
// two types, and the number had already lost the scale that respond.ts
// stringifies Decimals to preserve.
//
// Settled here rather than in server/queries/products.ts, because that
// module also feeds the storefront: product-card.tsx does
// `comparePrice > price`, and on strings that is a lexicographic
// comparison -- "999.99" > "1099.99" is true -- which would invert every
// sale badge on the site.
const MONEY_FIELDS = ['price', 'comparePrice'] as const;

function money(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Checked before the duck-type below, because a JS number has toFixed too.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(2) : value;
  }

  // Already a string: either a price respond.ts stringified, or something
  // this module has no business reinterpreting. NaN is not a price.
  if (typeof value === 'string') return value;

  // Prisma's Decimal, duck-typed the same way respond.ts does it, so this
  // module stays free of a runtime dependency on the client.
  const candidate = value as { toFixed?: unknown };
  if (typeof candidate.toFixed === 'function') {
    return (candidate.toFixed as (digits: number) => string)(2);
  }

  return value;
}

function withMoneyNormalised(
  source: Record<string, unknown>,
  target: Record<string, unknown>
): void {
  for (const field of MONEY_FIELDS) {
    if (field in source) target[field] = money(source[field]);
  }
}

export function publicProduct(
  product: Record<string, unknown>
): Record<string, unknown> {
  const view: Record<string, unknown> = {};

  for (const field of PUBLIC_PRODUCT_FIELDS) {
    if (field in product) view[field] = product[field];
  }

  withMoneyNormalised(product, view);

  // Variants carry their own prices, and a caller comparing a variant
  // price to its product price should not have to handle two types.
  if (Array.isArray(view.variants)) {
    view.variants = (view.variants as Record<string, unknown>[]).map(
      variant => {
        if (variant === null || typeof variant !== 'object') return variant;
        const copy = { ...variant };
        withMoneyNormalised(variant, copy);
        return copy;
      }
    );
  }

  return view;
}

export function publicProducts(
  products: Record<string, unknown>[]
): Record<string, unknown>[] {
  return products.map(publicProduct);
}
