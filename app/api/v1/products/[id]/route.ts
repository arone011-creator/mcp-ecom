// app/api/v1/products/[id]/route.ts
//
// GET /api/v1/products/:id -- a single product, public like the listing.
import type { NextRequest } from 'next/server';
import { getProductById } from '@/server/queries/products';
import { ok, fail } from '../../_lib/respond';
import { publicProduct } from '../../_lib/product-view';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = await getProductById(id);

    if (!product) return fail(404, 'Product not found');

    // getProductById has no status filter -- the storefront only ever
    // reaches it from links to published products, but an API can be
    // handed any id. Unpublished products are indistinguishable from
    // absent ones, so this cannot be used to probe for what is coming.
    if (product.status !== 'PUBLISHED') return fail(404, 'Product not found');

    return ok(publicProduct(product as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('GET /api/v1/products/[id] failed:', error);
    return fail(500, 'Failed to load product');
  }
}
