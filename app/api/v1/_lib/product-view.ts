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

export function publicProduct(
  product: Record<string, unknown>
): Record<string, unknown> {
  const view: Record<string, unknown> = {};

  for (const field of PUBLIC_PRODUCT_FIELDS) {
    if (field in product) view[field] = product[field];
  }

  return view;
}

export function publicProducts(
  products: Record<string, unknown>[]
): Record<string, unknown>[] {
  return products.map(publicProduct);
}
