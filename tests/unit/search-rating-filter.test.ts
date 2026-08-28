// tests/unit/search-rating-filter.test.ts
//
// "Find me shoes rated 4 or better" is one of the workflows the agent
// layer is being built for, so the filter has to be a real filter.
//
// The tempting shortcut -- fetch a page, then drop the low-rated ones from
// it in JavaScript -- looks like it works and is wrong in two ways that
// only show up later: pagination.total still counts the products that were
// dropped, and a page comes back short (or empty) while matching products
// sit unexamined on later pages. These tests pin the filtering to the
// database, before the page is taken.

const mockPrisma = {
  product: { findMany: jest.fn(), count: jest.fn() },
  review: { groupBy: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));

// unstable_cache would otherwise wrap the function and swallow the calls.
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: jest.fn(),
}));

import { searchProducts } from '@/server/queries/products';

function rated(productId: string) {
  return { productId, _avg: { rating: 4.5 } };
}

describe('searchProducts minRating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.review.groupBy.mockResolvedValue([]);
  });

  it('asks the database for the averages rather than computing them here', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([rated('p1'), rated('p2')]);

    await searchProducts({ query: 'shoes', minRating: 4 });

    expect(mockPrisma.review.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['productId'],
        having: { rating: { _avg: { gte: 4 } } },
      })
    );
  });

  it('restricts the product query to the qualifying ids', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([rated('p1'), rated('p2')]);

    await searchProducts({ query: 'shoes', minRating: 4 });

    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['p1', 'p2'] } }),
      })
    );
  });

  // The count has to see the same where clause as the page, or the caller
  // is told there are 40 results and handed 3.
  it('counts against the same filter it pages against', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([rated('p1')]);

    await searchProducts({ query: 'shoes', minRating: 4 });

    const pagedWhere = mockPrisma.product.findMany.mock.calls[0][0].where;
    const countedWhere = mockPrisma.product.count.mock.calls[0][0].where;

    // Asserted on its own terms rather than only against pagedWhere --
    // the two are the same object today, which would make a comparison
    // between them pass no matter what the filter contained.
    expect(countedWhere.id).toEqual({ in: ['p1'] });
    expect(countedWhere).toEqual(pagedWhere);
  });

  it('reports an empty result when nothing meets the bar', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([]);

    const result = await searchProducts({ query: 'shoes', minRating: 5 });

    expect(result.products).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  // A product nobody has reviewed has no rows to average, so it cannot
  // clear a 4+ bar. Excluding it is the correct answer, not an oversight.
  it('excludes products with no reviews at all', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([rated('p1')]);

    await searchProducts({ query: 'shoes', minRating: 4 });

    const { where } = mockPrisma.product.findMany.mock.calls[0][0];
    expect(where.id).toEqual({ in: ['p1'] });
  });

  it('does no rating work at all when no minimum is asked for', async () => {
    await searchProducts({ query: 'shoes' });

    expect(mockPrisma.review.groupBy).not.toHaveBeenCalled();
    const { where } = mockPrisma.product.findMany.mock.calls[0][0];
    expect(where.id).toBeUndefined();
  });

  it('still applies the other filters alongside the rating', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([rated('p1')]);

    await searchProducts({ query: 'shoes', minRating: 4, maxPrice: 100 });

    const { where } = mockPrisma.product.findMany.mock.calls[0][0];
    expect(where.id).toEqual({ in: ['p1'] });
    expect(where.price).toEqual({ lte: 100 });
    expect(where.status).toBe('PUBLISHED');
  });
});
