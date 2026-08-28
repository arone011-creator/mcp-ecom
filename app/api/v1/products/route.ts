// app/api/v1/products/route.ts
//
// GET /api/v1/products -- search and browse the catalogue.
//
// Deliberately unauthenticated: this is the same data the storefront shows
// to anyone who visits. Every other v1 route resolves a caller first.
import type { NextRequest } from 'next/server';
import { searchProducts } from '@/server/queries/products';
import { ok, fail } from '../_lib/respond';
import { publicProducts } from '../_lib/product-view';

const DEFAULT_LIMIT = 20;
// An agent asking for "all the products" should get a page, not the
// catalogue -- both to bound the query and to bound the context it lands in.
const MAX_LIMIT = 50;

function intParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function floatParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    // Clamped rather than validated: a caller that asks for page -3 wants
    // the first page, and rejecting it only costs a round trip.
    const limit = Math.min(
      Math.max(intParam(params.get('limit')) ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const page = Math.max(intParam(params.get('page')) ?? 1, 1);

    const result = await searchProducts({
      // An empty query matches everything published, which makes this the
      // plain catalogue listing when no search term is given.
      query: params.get('q') ?? '',
      page,
      limit,
      // Only 'price' and 'name' are honoured downstream; anything else
      // falls back to newest first.
      sort: params.get('sort') ?? undefined,
      categoryFilter: params.get('category') ?? undefined,
      minPrice: floatParam(params.get('minPrice')),
      maxPrice: floatParam(params.get('maxPrice')),
    });

    return ok({
      products: publicProducts(result.products as Record<string, unknown>[]),
      pagination: result.pagination,
    });
  } catch (error) {
    // Logged in full, reported generically: the message can carry the
    // connection string.
    console.error('GET /api/v1/products failed:', error);
    return fail(500, 'Failed to search products');
  }
}
