import { ArrowLeft } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { isApiRequestError } from '../../api/http';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Card, CardBody, CardFooter } from '../../components/ui/Card';
import { CheckboxField, TextField } from '../../components/ui/Field';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSubmit } from '../../hooks/useSubmit';
import { describeError } from '../../lib/describeError';
import { formatMoneyPrecise } from '../../lib/format';
import { useCategories } from './useCategories';

const EMPTY = { sku: '', name: '', category: '', unitPrice: '', active: true };

/** Create a catalogue product. */
export function NewProductPage() {
  useDocumentTitle('New product');

  const [form, setForm] = useState(EMPTY);
  const categories = useCategories();
  const categoryListId = useId();

  const { submitting, error, fieldErrors, result, submit, reset } = useSubmit(api.createProduct);
  const duplicateSku = isApiRequestError(error) && error.status === 409;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // An empty string would coerce to 0; sending it unset lets the API report a
    // missing price rather than silently accepting a free product.
    submit({
      sku: form.sku,
      name: form.name,
      category: form.category,
      unitPrice: form.unitPrice === '' ? undefined : Number(form.unitPrice),
      active: form.active,
    });
  }

  return (
    <>
      <PageHeader
        title="New product"
        description="SKU must be unique. Only active products may be added to new orders."
        actions={
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to products
          </Link>
        }
      />

      <div className="max-w-2xl space-y-6">
        {result ? (
          <Callout tone="positive" title={`${result.name} was created`}>
            <p>
              {result.sku} · {result.category} · {formatMoneyPrecise(result.unitPrice)}
            </p>
            <p className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setForm(EMPTY);
                  reset();
                }}
              >
                Add another
              </Button>
              <Link to="/products" className="inline-flex">
                <Button variant="ghost" size="sm">
                  View catalogue
                </Button>
              </Link>
            </p>
          </Callout>
        ) : null}

        {error !== undefined && Object.keys(fieldErrors).length === 0 && !duplicateSku ? (
          <Callout tone="critical" title={describeError(error).title}>
            {describeError(error).message}
          </Callout>
        ) : null}

        <Card>
          <form onSubmit={onSubmit} noValidate>
            <CardBody className="space-y-5 pt-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  label="SKU"
                  required
                  placeholder="ELEC-0101"
                  value={form.sku}
                  error={duplicateSku ? describeError(error).message : fieldErrors.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                />

                <TextField
                  label="Unit price"
                  type="number"
                  required
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  hint="In rupees."
                  value={form.unitPrice}
                  error={fieldErrors.unitPrice}
                  onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
                />
              </div>

              <TextField
                label="Product name"
                required
                value={form.name}
                error={fieldErrors.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />

              <div>
                <TextField
                  label="Category"
                  required
                  list={categoryListId}
                  hint="Choose an existing category or type a new one."
                  value={form.category}
                  error={fieldErrors.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
                {/* A datalist suggests without restricting: the API accepts any
                    category, so the control must not pretend otherwise. */}
                <datalist id={categoryListId}>
                  {categories.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <CheckboxField
                label="Available for new orders"
                hint="Clear this to retire the product. Existing orders keep it."
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
            </CardBody>

            <CardFooter className="flex justify-end gap-2">
              <Link to="/products" className="inline-flex">
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" loading={submitting}>
                Create product
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}
