// tests/integration/api-v1-products.test.ts
//
// Product reads are the one deliberately public corner of the v1 API --
// the storefront shows this data to anyone. "Public" is not the same as
// "everything in the row", though: searchProducts and getProductById both
// select whole Product records, which include costPrice, and
// getProductById does not filter on status. These tests hold the API's
// projection to what a stranger is actually allowed to see.

const mockPrisma = { inventory: { findUnique: jest.fn() } };
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

jest.mock('@/server/queries/products', () => ({
  searchProducts: jest.fn(),
  getProductById: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { searchProducts, getProductById } from '@/server/queries/products';
import { GET as listProducts } from '@/app/api/v1/products/route';
import { GET as getProduct } from '@/app/api/v1/products/[id]/route';
import { GET as getInventory } from '@/app/api/v1/products/[id]/inventory/route';

const mockSearch = searchProducts as unknown as jest.Mock;
const mockGetById = getProductById as unknown as jest.Mock;

// The real return shape of searchProducts: { products, pagination }.
function searchResult(products: unknown[] = [], total = 0) {
  return {
    products,
    pagination: { page: 1, limit: 20, total, pages: Math.ceil(total / 20) },
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Runner',
    slug: 'runner',
    description: 'A shoe',
    price: 79.99,
    comparePrice: 99.99,
    costPrice: 31.5,
    status: 'PUBLISHED',
    sku: 'RUN-1',
    tags: ['shoes'],
    category: { id: 'c1', name: 'Shoes', slug: 'shoes' },
    images: [{ url: '/a.jpg', altText: 'a' }],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function listRequest(query = '') {
  return new NextRequest(`https://x.test/api/v1/products${query}`);
}

describe('GET /api/v1/products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockResolvedValue(searchResult());
  });

  it('passes query and price filters through to searchProducts', async () => {
    await listProducts(
      listRequest('?q=headphones&maxPrice=10000&minPrice=50&limit=5')
    );

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'headphones',
        minPrice: 50,
        maxPrice: 10000,
        limit: 5,
      })
    );
  });

  it('returns results and pagination under a data envelope', async () => {
    mockSearch.mockResolvedValue(searchResult([product()], 1));

    const body = await (await listProducts(listRequest('?q=x'))).json();

    expect(body.data.products).toHaveLength(1);
    expect(body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      pages: 1,
    });
  });

  it('serves an empty query as a plain catalogue listing', async () => {
    await listProducts(listRequest());

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: '' })
    );
  });

  it('needs no credentials at all', async () => {
    const res = await listProducts(listRequest('?q=x'));

    expect(res.status).toBe(200);
  });

  describe('bounds', () => {
    it('caps limit at 50 so one call cannot pull the whole catalogue', async () => {
      await listProducts(listRequest('?q=x&limit=9999'));

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });

    it('floors limit at 1 rather than passing zero into the skip maths', async () => {
      await listProducts(listRequest('?q=x&limit=0'));

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 })
      );
    });

    it('floors page at 1 so a negative page cannot skip backwards', async () => {
      await listProducts(listRequest('?q=x&page=-3'));

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 })
      );
    });

    it('falls back to defaults for non-numeric paging', async () => {
      await listProducts(listRequest('?q=x&limit=abc&page=xyz'));

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, page: 1 })
      );
    });
  });

  it('never exposes costPrice', async () => {
    mockSearch.mockResolvedValue(searchResult([product()], 1));

    const raw = await (await listProducts(listRequest('?q=x'))).text();

    expect(raw).not.toContain('costPrice');
    expect(raw).not.toContain('31.5');
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockSearch.mockRejectedValue(new Error('connection string: postgres://u:p@h'));

    const res = await listProducts(listRequest('?q=x'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });
});

describe('GET /api/v1/products/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  function detail(id: string) {
    return getProduct(new NextRequest(`https://x.test/api/v1/products/${id}`), {
      params: Promise.resolve({ id }),
    });
  }

  it('returns the product when found', async () => {
    mockGetById.mockResolvedValue(product());

    const body = await (await detail('p1')).json();

    expect(body.data.name).toBe('Runner');
    expect(body.data.category.slug).toBe('shoes');
  });

  it('404s for an unknown product', async () => {
    mockGetById.mockResolvedValue(null);

    expect((await detail('nope')).status).toBe(404);
  });

  // getProductById has no status filter, so without this the API is a
  // window onto unreleased products for anyone who can guess an id.
  it('404s for a product that is not published', async () => {
    mockGetById.mockResolvedValue(product({ status: 'DRAFT' }));

    expect((await detail('p1')).status).toBe(404);
  });

  it('404s for an archived product', async () => {
    mockGetById.mockResolvedValue(product({ status: 'ARCHIVED' }));

    expect((await detail('p1')).status).toBe(404);
  });

  it('never exposes costPrice', async () => {
    mockGetById.mockResolvedValue(product());

    const raw = await (await detail('p1')).text();

    expect(raw).not.toContain('costPrice');
    expect(raw).not.toContain('31.5');
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockGetById.mockRejectedValue(new Error('connection string: postgres://u:p@h'));

    const res = await detail('p1');

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});

describe('GET /api/v1/products/[id]/inventory', () => {
  beforeEach(() => jest.clearAllMocks());

  function inventory(id: string) {
    return getInventory(
      new NextRequest(`https://x.test/api/v1/products/${id}/inventory`),
      { params: Promise.resolve({ id }) }
    );
  }

  it('reports stock levels and an in-stock flag', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'p1',
      quantity: 10,
      reserved: 2,
      available: 8,
    });

    const body = await (await inventory('p1')).json();

    expect(body.data).toEqual({
      productId: 'p1',
      quantity: 10,
      reserved: 2,
      available: 8,
      inStock: true,
    });
  });

  it('reports out of stock when nothing is available', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      productId: 'p1',
      quantity: 4,
      reserved: 4,
      available: 0,
    });

    const body = await (await inventory('p1')).json();

    expect(body.data.inStock).toBe(false);
  });

  it('404s when the product has no inventory record', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue(null);

    expect((await inventory('p1')).status).toBe(404);
  });

  it('reports a failure without echoing the underlying error', async () => {
    mockPrisma.inventory.findUnique.mockRejectedValue(
      new Error('connection string: postgres://u:p@h')
    );

    const res = await inventory('p1');

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('postgres://');
  });
});
