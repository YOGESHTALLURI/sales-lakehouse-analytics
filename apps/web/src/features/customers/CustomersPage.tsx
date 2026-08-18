import { Plus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PAGE_LIMITS } from '../../api/endpoints';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataPanel } from '../../components/DataPanel';
import { buttonClasses } from '../../components/ui/Button';
import { CardFooter } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, TableCaption, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useQueryState } from '../../hooks/useQueryState';
import { formatDate } from '../../lib/format';

/** Customer records from PostgreSQL, paginated through the API's envelope. */
export function CustomersPage() {
  useDocumentTitle('Customers');

  const query = useQueryState();
  const limit = query.getNumber('limit', PAGE_LIMITS.default);
  const offset = query.getNumber('offset', 0);

  const result = useAsync((signal) => api.listCustomers({ limit, offset }, signal), [
    limit,
    offset,
  ]);

  const customers = result.data?.data ?? [];
  const pagination = result.data?.pagination;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every customer on record, newest first."
        actions={
          <Link to="/customers/new" className={buttonClasses('primary', 'md')}>
            <Plus aria-hidden className="size-4" />
            New customer
          </Link>
        }
      />

      <DataPanel
        title="All customers"
        status={result.status}
        error={result.error}
        onRetry={result.refresh}
        refreshing={result.isRefreshing}
        hasData={result.data !== undefined}
        isEmpty={customers.length === 0}
        emptyIcon={Users}
        emptyTitle="No customers yet"
        emptyDescription="Create the first customer to start recording sales."
        skeleton="table"
        skeletonColumns={5}
      >
        <TableFrame>
          <TableCaption>Customers with their email address, city, state and created date.</TableCaption>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>City</Th>
              <Th>State</Th>
              <Th align="right">Created</Th>
            </tr>
          </THead>
          <TBody>
            {customers.map((customer) => (
              <Tr key={customer.id}>
                <Td className="font-medium text-ink">{customer.name}</Td>
                <Td>{customer.email}</Td>
                <Td>{customer.city}</Td>
                <Td>{customer.state}</Td>
                <Td align="right" className="whitespace-nowrap text-ink-muted">
                  {formatDate(customer.createdAt.slice(0, 10))}
                </Td>
              </Tr>
            ))}
          </TBody>
        </TableFrame>

        {pagination ? (
          <CardFooter>
            <Pagination
              limit={pagination.limit}
              offset={pagination.offset}
              total={pagination.total}
              noun="customers"
              disabled={result.isRefreshing}
              onOffsetChange={(next) => query.set({ offset: next === 0 ? undefined : next })}
              onLimitChange={(next) =>
                query.set({ limit: next === PAGE_LIMITS.default ? undefined : next, offset: undefined })
              }
            />
          </CardFooter>
        ) : null}
      </DataPanel>
    </>
  );
}
