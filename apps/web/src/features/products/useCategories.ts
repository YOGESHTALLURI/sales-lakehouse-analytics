import { api } from '../../api/client';
import { PAGE_LIMITS } from '../../api/endpoints';
import { useAsync } from '../../hooks/useAsync';

/**
 * The set of categories currently in the catalogue.
 *
 * The contract exposes no categories endpoint and no facets, so this derives them
 * from one page at the documented maximum limit. That covers the catalogue as it
 * stands (100 products) but is not a general solution — see
 * apps/web/CONTRACT-REQUESTS.md, which asks the backend workstream for either a
 * categories endpoint or a facet on the product list.
 */
export function useCategories(): readonly string[] {
  const result = useAsync(
    (signal) => api.listProducts({ limit: PAGE_LIMITS.max }, signal),
    [],
  );

  const categories = new Set((result.data?.data ?? []).map((product) => product.category));
  return [...categories].sort((left, right) => left.localeCompare(right));
}
