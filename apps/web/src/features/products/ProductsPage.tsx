import { Package, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PAGE_LIMITS } from '../../api/endpoints';
import { DataPanel } from '../../components/DataPanel';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { buttonClasses } from '../../components/ui/Button';
import { CardFooter } from '../../components/ui/Card';
import { BareSelect } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, TableCaption, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useQueryState } from '../../hooks/useQueryState';
import { formatMoneyPrecise } from '../../lib/format';
import { categoryIcon } from './categoryIcon';
import { useCategories } from './useCategories';

const ACTIVE_OPTIONS = [
  { value: '', label: 'All products' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Retired only' },
];

/** The product catalogue, with the two filters the contract supports. */
export function ProductsPage() {
  useDocumentTitle('Products');

  const query = useQueryState();
  const categories = useCategories();

  const limit = query.getNumber('limit', PAGE_LIMITS.default);
  const offset = query.getNumber('offset', 0);
  const category = query.get('category') ?? '';
  const activeRaw = query.get('active') ?? '';
  const active = activeRaw === 'true' ? true : activeRaw === 'false' ? false : undefined;

  const result = useAsync(
    (signal) =>
      api.listProducts(
        { limit, offset, category: category === '' ? undefined : category, active },
        signal,
      ),
    [limit, offset, category, activeRaw],
  );

  const products = result.data?.data ?? [];
  const pagination = result.data?.pagination;
  const filtered = category !== '' || activeRaw !== '';

  return (
    <>
      <PageHeader
        title="Products"
        description="The catalogue that new orders draw from. Retired products stay on historical orders."
        actions={
          <Link to="/products/new" className={buttonClasses('primary', 'md')}>
            <Plus aria-hidden className="size-4" />
            New product
          </Link>
        }
      />

      <DataPanel
        title="Catalogue"
        status={result.status}
        error={result.error}
        onRetry={result.refresh}
        refreshing={result.isRefreshing}
        hasData={result.data !== undefined}
        isEmpty={products.length === 0}
        emptyIcon={Package}
        emptyTitle={filtered ? 'No products match these filters' : 'No products yet'}
        emptyDescription={
          filtered ? 'Clear a filter to see more of the catalogue.' : 'Add the first product.'
        }
        skeleton="table"
        skeletonColumns={5}
        actions={
          <>
            <BareSelect
              label="Filter by category"
              className="h-9 w-auto"
              value={category}
              options={[
                { value: '', label: 'All categories' },
                ...categories.map((name) => ({ value: name, label: name })),
              ]}
              onChange={(event) =>
                query.set({ category: event.target.value, offset: undefined })
              }
            />
            <BareSelect
              label="Filter by availability"
              className="h-9 w-auto"
              value={activeRaw}
              options={ACTIVE_OPTIONS}
              onChange={(event) => query.set({ active: event.target.value, offset: undefined })}
            />
          </>
        }
      >
        <TableFrame>
          <TableCaption>
            Products with SKU, category, unit price and whether they may be added to new orders.
          </TableCaption>
          <THead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th>Category</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Status</Th>
            </tr>
          </THead>
          <TBody>
            {products.map((product) => {
              const Icon = categoryIcon(product.category);

              return (
                <Tr key={product.id}>
                  <Td>
                    <span className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken">
                        <Icon aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
                      </span>
                      <span className="font-medium text-ink">{product.name}</span>
                    </span>
                  </Td>
                  <Td className="font-mono text-xs text-ink-muted">{product.sku}</Td>
                  <Td className="whitespace-nowrap">{product.category}</Td>
                  <Td align="right" className="font-medium text-ink">
                    {formatMoneyPrecise(product.unitPrice)}
                  </Td>
                  <Td align="right">
                    <Badge tone={product.active ? 'positive' : 'neutral'} dot>
                      {product.active ? 'Active' : 'Retired'}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </TableFrame>

        {pagination ? (
          <CardFooter>
            <Pagination
              limit={pagination.limit}
              offset={pagination.offset}
              total={pagination.total}
              noun="products"
              disabled={result.isRefreshing}
              onOffsetChange={(next) => query.set({ offset: next === 0 ? undefined : next })}
              onLimitChange={(next) =>
                query.set({
                  limit: next === PAGE_LIMITS.default ? undefined : next,
                  offset: undefined,
                })
              }
            />
          </CardFooter>
        ) : null}
      </DataPanel>
    </>
  );
}
