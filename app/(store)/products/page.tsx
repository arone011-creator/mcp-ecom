// File: app/(store)/products/page.tsx
import { Metadata } from 'next';
import Link from 'next/link';
import { getProducts } from '@/server/queries/products';
import { ProductGrid } from '@/components/product-grid';
import { SortSelect } from '@/components/sort-select';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'All Products',
  description: 'Browse the full catalogue.',
};

interface ProductsPageProps {
  searchParams: Promise<{
    sort?: string;
    category?: string;
    page?: string;
  }>;
}

const PER_PAGE = 12;

// Eleven places across the app linked here -- the home page's primary
// call to action, every product and category breadcrumb, "Continue
// Shopping" in the cart, and the empty state on search -- while the route
// did not exist and returned 404 from all of them.
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const resolved = await searchParams;
  const page = Math.max(1, parseInt(resolved.page || '1', 10) || 1);

  const sortMap: Record<string, { sortBy: string; sortOrder: 'asc' | 'desc' }> =
    {
      newest: { sortBy: 'createdAt', sortOrder: 'desc' },
      'price-asc': { sortBy: 'price', sortOrder: 'asc' },
      'price-desc': { sortBy: 'price', sortOrder: 'desc' },
      name: { sortBy: 'name', sortOrder: 'asc' },
    };
  const sort = sortMap[resolved.sort ?? 'newest'] ?? sortMap.newest;

  const { products, pagination } = await getProducts({
    page,
    limit: PER_PAGE,
    category: resolved.category,
    ...sort,
  } as never);

  const pageLink = (n: number) => {
    const params = new URLSearchParams();
    if (resolved.sort) params.set('sort', resolved.sort);
    if (resolved.category) params.set('category', resolved.category);
    params.set('page', String(n));
    return `/products?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          All products
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pagination.total} {pagination.total === 1 ? 'product' : 'products'}
          {resolved.category ? ` in ${resolved.category}` : ''}
        </p>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {pagination.page} of {Math.max(1, pagination.pages)}
        </p>
        <SortSelect />
      </div>

      <ProductGrid products={products as never} />

      {pagination.pages > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          {page > 1 && (
            <Button asChild variant="outline">
              <Link href={pageLink(page - 1)}>Previous</Link>
            </Button>
          )}
          {page < pagination.pages && (
            <Button asChild variant="outline">
              <Link href={pageLink(page + 1)}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
