import { ArrowLeft, CircleCheck, Plus, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { isApiRequestError } from '../../api/http';
import type { Order, OrderStatus, Product } from '../../api/types';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { TBody, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/States';
import { useAccumulatingList } from '../../hooks/useAccumulatingList';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSubmit } from '../../hooks/useSubmit';
import { describeError } from '../../lib/describeError';
import { formatCount, formatMoneyPrecise, todayIso } from '../../lib/format';
import { useCategories } from '../products/useCategories';
import { ORDER_STATUS_OPTIONS } from './orderStatus';

interface Line {
  readonly productId: string;
  readonly quantity: number;
}

const MAX_LINES = 50;
const MAX_QUANTITY = 1000;

/**
 * Record a multi-item sale.
 *
 * Three server-side rules shape this form:
 *
 *  - **One line per product.** Adding a product already on the order increases
 *    that line's quantity instead of creating a duplicate the API would reject.
 *  - **Active products only.** The picker requests `?active=true`, so a retired
 *    product cannot normally be chosen — the `product_inactive` conflict is still
 *    handled, because the catalogue can change between loading and submitting.
 *  - **`unitPriceAtSale` is omitted.** The API captures the catalogue price inside
 *    the transaction, which is more trustworthy than a price this page read
 *    earlier. The total shown before submitting is therefore an estimate, and the
 *    figure after submitting is the API's own.
 */
export function NewOrderPage() {
  useDocumentTitle('New order');

  const [customerId, setCustomerId] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [orderDate, setOrderDate] = useState(todayIso());
  const [status, setStatus] = useState<OrderStatus>('pending');

  const [lines, setLines] = useState<readonly Line[]>([]);
  const [category, setCategory] = useState('');
  const [productToAdd, setProductToAdd] = useState('');
  const [quantityToAdd, setQuantityToAdd] = useState('1');
  const [mergedNote, setMergedNote] = useState<string | undefined>(undefined);

  const categories = useCategories();

  const customers = useAccumulatingList(
    (offset, limit, signal) => api.listCustomers({ limit, offset }, signal),
    [],
  );

  const products = useAccumulatingList(
    (offset, limit, signal) =>
      api.listProducts(
        { limit, offset, active: true, category: category === '' ? undefined : category },
        signal,
      ),
    [category],
  );

  const { submitting, error, fieldErrors, result, submit, reset } = useSubmit(api.createOrder);

  const productsById = useMemo(
    () => new Map(products.rows.map((product) => [product.id, product])),
    [products.rows],
  );

  const visibleCustomers = useMemo(() => {
    const needle = customerFilter.trim().toLowerCase();
    const matches =
      needle === ''
        ? customers.rows
        : customers.rows.filter(
            (customer) =>
              customer.name.toLowerCase().includes(needle) ||
              customer.email.toLowerCase().includes(needle) ||
              customer.city.toLowerCase().includes(needle),
          );

    return matches.slice(0, 200);
  }, [customers.rows, customerFilter]);

  const estimatedTotal = lines.reduce((sum, line) => {
    const product = productsById.get(line.productId);
    return sum + (product ? product.unitPrice * line.quantity : 0);
  }, 0);

  function addLine(): void {
    const product = productsById.get(productToAdd);
    const quantity = Number(quantityToAdd);

    if (!product || !Number.isInteger(quantity) || quantity < 1) return;

    setMergedNote(undefined);
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);

      if (existing) {
        setMergedNote(
          `${product.name} was already on this order, so its quantity increased to ${Math.min(existing.quantity + quantity, MAX_QUANTITY)}.`,
        );
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: Math.min(line.quantity + quantity, MAX_QUANTITY) }
            : line,
        );
      }

      if (current.length >= MAX_LINES) return current;
      return [...current, { productId: product.id, quantity }];
    });

    setProductToAdd('');
    setQuantityToAdd('1');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit({
      customerId,
      orderDate,
      status,
      items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });
  }

  function startNewOrder(): void {
    setCustomerId('');
    setCustomerFilter('');
    setOrderDate(todayIso());
    setStatus('pending');
    setLines([]);
    setProductToAdd('');
    setQuantityToAdd('1');
    setMergedNote(undefined);
    reset();
  }

  if (result) {
    return <OrderCreated order={result} onNewOrder={startNewOrder} />;
  }

  const stale =
    isApiRequestError(error) &&
    (error.code === 'customer_not_found' ||
      error.code === 'product_not_found' ||
      error.code === 'product_inactive');

  const generalError =
    error !== undefined && Object.keys(fieldErrors).length === 0 ? describeError(error) : undefined;

  return (
    <>
      <PageHeader
        title="New order"
        description="The order header and every line are written in one transaction. If any line is rejected, nothing is saved."
        actions={
          <Link
            to="/sales"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to sales
          </Link>
        }
      />

      <form onSubmit={onSubmit} noValidate className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {generalError ? (
            <Callout tone="critical" title={generalError.title}>
              {generalError.message}
              {stale ? (
                <span className="mt-3 flex">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => window.location.reload()}
                  >
                    <RefreshCw aria-hidden className="size-4" />
                    Reload customers and catalogue
                  </Button>
                </span>
              ) : null}
            </Callout>
          ) : null}

          <Card>
            <CardHeader title="Customer" level={2} />
            <CardBody className="space-y-5">
              <TextField
                label="Find a customer"
                type="search"
                placeholder="Name, email or city"
                hint={
                  customers.hasMore
                    ? `Searching the ${formatCount(customers.rows.length)} of ${formatCount(customers.total)} customers loaded so far.`
                    : `Searching all ${formatCount(customers.total)} customers.`
                }
                value={customerFilter}
                onChange={(event) => setCustomerFilter(event.target.value)}
              />

              <SelectField
                label="Customer"
                required
                placeholder={customers.loading ? 'Loading customers…' : 'Choose a customer'}
                error={fieldErrors.customerId}
                value={customerId}
                options={visibleCustomers.map((customer) => ({
                  value: customer.id,
                  label: `${customer.name} · ${customer.city}, ${customer.state}`,
                }))}
                onChange={(event) => setCustomerId(event.target.value)}
              />

              {customers.hasMore ? (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  loading={customers.loading}
                  onClick={customers.loadMore}
                >
                  Load more customers
                </Button>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Products"
              level={2}
              description="Only active products can be added. Adding one twice increases its quantity."
            />

            <CardBody className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Category"
                    placeholder="All categories"
                    value={category}
                    options={categories.map((name) => ({ value: name, label: name }))}
                    onChange={(event) => {
                      setCategory(event.target.value);
                      setProductToAdd('');
                    }}
                  />

                  <SelectField
                    label="Product"
                    placeholder={products.loading ? 'Loading products…' : 'Choose a product'}
                    value={productToAdd}
                    options={products.rows.map((product) => ({
                      value: product.id,
                      label: `${product.name} — ${formatMoneyPrecise(product.unitPrice)}`,
                    }))}
                    onChange={(event) => setProductToAdd(event.target.value)}
                  />
                </div>

                <div className="flex items-end gap-2">
                  <div className="w-24">
                    <TextField
                      label="Quantity"
                      type="number"
                      min={1}
                      max={MAX_QUANTITY}
                      step={1}
                      inputMode="numeric"
                      value={quantityToAdd}
                      onChange={(event) => setQuantityToAdd(event.target.value)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={addLine}
                    disabled={productToAdd === '' || lines.length >= MAX_LINES}
                  >
                    <Plus aria-hidden className="size-4" />
                    Add
                  </Button>
                </div>
              </div>

              {products.hasMore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  loading={products.loading}
                  onClick={products.loadMore}
                >
                  Load more products
                </Button>
              ) : null}

              {mergedNote ? (
                <Callout tone="info" onDismiss={() => setMergedNote(undefined)}>
                  {mergedNote}
                </Callout>
              ) : null}

              {fieldErrors.items ? (
                <Callout tone="critical">{fieldErrors.items}</Callout>
              ) : null}
            </CardBody>

            {lines.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No lines yet"
                description="Choose a product above and add it to the order."
              />
            ) : (
              <LineTable
                lines={lines}
                productsById={productsById}
                fieldErrors={fieldErrors}
                onQuantityChange={(productId, quantity) =>
                  setLines((current) =>
                    current.map((line) =>
                      line.productId === productId ? { ...line, quantity } : line,
                    ),
                  )
                }
                onRemove={(productId) =>
                  setLines((current) => current.filter((line) => line.productId !== productId))
                }
              />
            )}
          </Card>
        </div>

        <div className="xl:sticky xl:top-8 xl:self-start">
          <Card>
            <CardHeader title="Order details" level={2} />
            <CardBody className="space-y-5">
              <TextField
                label="Order date"
                type="date"
                required
                max={todayIso()}
                hint="May not be in the future."
                value={orderDate}
                error={fieldErrors.orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />

              <SelectField
                label="Status"
                value={status}
                options={ORDER_STATUS_OPTIONS}
                error={fieldErrors.status}
                onChange={(event) => {
                  const next = ORDER_STATUS_OPTIONS.find(
                    (option) => option.value === event.target.value,
                  );
                  if (next) setStatus(next.value);
                }}
              />

              <dl className="space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Lines</dt>
                  <dd className="font-medium text-ink" data-numeric>
                    {formatCount(lines.length)} of {MAX_LINES}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Units</dt>
                  <dd className="font-medium text-ink" data-numeric>
                    {formatCount(lines.reduce((sum, line) => sum + line.quantity, 0))}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <dt className="font-medium text-ink-soft">Estimated total</dt>
                  <dd className="text-xl font-semibold text-ink" data-numeric>
                    {formatMoneyPrecise(estimatedTotal)}
                  </dd>
                </div>
              </dl>

              <p className="text-xs text-ink-faint">
                The API captures each product&rsquo;s price inside the transaction, so the saved
                total is authoritative.
              </p>
            </CardBody>

            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                loading={submitting}
                disabled={customerId === '' || lines.length === 0}
              >
                Create order
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>
    </>
  );
}

interface LineTableProps {
  lines: readonly Line[];
  productsById: ReadonlyMap<string, Product>;
  fieldErrors: Readonly<Record<string, string>>;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

function LineTable({
  lines,
  productsById,
  fieldErrors,
  onQuantityChange,
  onRemove,
}: LineTableProps) {
  return (
    <TableFrame className="border-t border-line">
      <caption className="sr-only">
        Lines on this order, with the quantity and current catalogue price of each.
      </caption>
      <THead>
        <tr>
          <Th>Product</Th>
          <Th align="right">Unit price</Th>
          <Th align="right">Quantity</Th>
          <Th align="right">Line estimate</Th>
          <Th align="right">
            <span className="sr-only">Remove</span>
          </Th>
        </tr>
      </THead>
      <TBody>
        {lines.map((line, index) => {
          const product = productsById.get(line.productId);
          const quantityError = fieldErrors[`items.${index}.quantity`];
          const productError = fieldErrors[`items.${index}.productId`];

          return (
            <Tr key={line.productId}>
              <Td>
                <span className="block font-medium text-ink">{product?.name ?? 'Product'}</span>
                <span className="block font-mono text-xs text-ink-faint">{product?.sku}</span>
                {productError ? (
                  <span className="mt-1 block text-xs text-critical">{productError}</span>
                ) : null}
              </Td>
              <Td align="right">
                {product ? formatMoneyPrecise(product.unitPrice) : '—'}
              </Td>
              <Td align="right">
                <input
                  type="number"
                  min={1}
                  max={MAX_QUANTITY}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Quantity for ${product?.name ?? 'this product'}`}
                  aria-invalid={quantityError === undefined ? undefined : true}
                  value={line.quantity}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isInteger(next) && next >= 1 && next <= MAX_QUANTITY) {
                      onQuantityChange(line.productId, next);
                    }
                  }}
                  className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-right text-sm text-ink hover:border-line-strong aria-invalid:border-critical"
                />
                {quantityError ? (
                  <span className="mt-1 block text-xs text-critical">{quantityError}</span>
                ) : null}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {product ? formatMoneyPrecise(product.unitPrice * line.quantity) : '—'}
              </Td>
              <Td align="right">
                <button
                  type="button"
                  onClick={() => onRemove(line.productId)}
                  className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-critical-surface hover:text-critical"
                >
                  <Trash2 aria-hidden className="size-4" />
                  <span className="sr-only">Remove {product?.name ?? 'line'}</span>
                </button>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </TableFrame>
  );
}

/** What the API actually saved, including the total it computed. */
function OrderCreated({ order, onNewOrder }: { order: Order; onNewOrder: () => void }) {
  return (
    <>
      <PageHeader
        title="Order created"
        description="Written to PostgreSQL. It will appear in the warehouse after the next pipeline run."
      />

      <div className="max-w-3xl space-y-6">
        <Callout tone="positive" title={`Order ${order.id.slice(0, 8)} was created`}>
          {order.customerName ? `For ${order.customerName}. ` : null}
          {formatCount(order.itemCount)} line{order.itemCount === 1 ? '' : 's'}, totalling{' '}
          {formatMoneyPrecise(order.orderTotal)}.
        </Callout>

        <Card>
          <CardHeader title="Saved lines" description="Prices as captured at the time of sale." />
          <TableFrame className="border-t border-line">
            <THead>
              <tr>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Price at sale</Th>
                <Th align="right">Line total</Th>
              </tr>
            </THead>
            <TBody>
              {order.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-mono text-xs text-ink-muted">{item.sku}</Td>
                  <Td className="text-ink">{item.productName}</Td>
                  <Td align="right">{formatCount(item.quantity)}</Td>
                  <Td align="right">{formatMoneyPrecise(item.unitPriceAtSale)}</Td>
                  <Td align="right" className="font-medium text-ink">
                    {formatMoneyPrecise(item.lineTotal)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableFrame>
          <CardFooter className="flex flex-wrap items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-sm text-positive">
              <CircleCheck aria-hidden className="size-4" strokeWidth={2} />
              Order total {formatMoneyPrecise(order.orderTotal)}
            </p>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={onNewOrder}>
                Create another order
              </Button>
              <Link to="/sales" className="inline-flex">
                <Button>View order history</Button>
              </Link>
            </span>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
