// app/api/v1/products/[id]/inventory/route.ts
//
// GET /api/v1/products/:id/inventory -- stock levels for one product.
//
// Separate from the product route because it is the one piece of product
// data that must never be cached: an agent deciding whether it can add
// three of something needs the number as it is now, not as it was.
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { ok, fail } from '../../../_lib/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const inventory = await prisma.inventory.findUnique({
      where: { productId: id },
      select: {
        productId: true,
        quantity: true,
        reserved: true,
        available: true,
      },
    });

    if (!inventory) return fail(404, 'No inventory record for that product');

    // `available` is the field checkout decrements against, so it is the
    // one that answers "can I buy this", not `quantity`.
    return ok({ ...inventory, inStock: inventory.available > 0 });
  } catch (error) {
    console.error('GET /api/v1/products/[id]/inventory failed:', error);
    return fail(500, 'Failed to load inventory');
  }
}
