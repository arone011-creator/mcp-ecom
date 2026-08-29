// tests/integration/api-v1-products-rating.test.ts
//
// Route-level half of the rating filter: does the parameter reach the
// query layer, and is it absent rather than zero when nobody asked for it.
// Whether the filter is actually correct is tested against the query
// itself, in tests/unit/search-rating-filter.test.ts.

jest.mock('@/server/queries/products', () => ({
  searchProducts: jest.fn(),
  getProductById: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { searchProducts } from '@/server/queries/products';
import { GET as listProducts } from '@/app/api/v1/products/route';

const mockSearch = searchProducts as unknown as jest.Mock;

const list = (query: string) =>
  listProducts(new NextRequest(`https://x.test/api/v1/products${query}`));

describe('minRating parameter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockResolvedValue({
      products: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 },
    });
  });

  it('passes minRating through when provided', async () => {
    await list('?q=shoes&minRating=4.3');

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ minRating: 4.3 })
    );
  });

  // A defaulted 0 would look like a filter to the query layer and quietly
  // exclude every product with no reviews.
  it('omits minRating when absent rather than defaulting to zero', async () => {
    await list('?q=shoes');

    expect(mockSearch.mock.calls[0][0].minRating).toBeUndefined();
  });

  it('ignores a non-numeric minRating rather than passing NaN to the database', async () => {
    await list('?q=shoes&minRating=excellent');

    expect(mockSearch.mock.calls[0][0].minRating).toBeUndefined();
  });

  it('keeps a whole-number rating usable', async () => {
    await list('?q=shoes&minRating=4');

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ minRating: 4 })
    );
  });
});
