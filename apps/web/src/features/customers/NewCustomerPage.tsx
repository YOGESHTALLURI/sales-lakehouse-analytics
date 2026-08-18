import { ArrowLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Card, CardBody, CardFooter } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSubmit } from '../../hooks/useSubmit';
import { describeError } from '../../lib/describeError';
import { isApiRequestError } from '../../api/http';

const EMPTY = { name: '', email: '', city: '', state: '' };

/**
 * Create a customer.
 *
 * A page rather than a modal: it is linkable, needs no focus trap, and the browser
 * back button is a working cancel. Validation is left to the API — duplicating its
 * rules here would mean two sources of truth that drift apart.
 */
export function NewCustomerPage() {
  useDocumentTitle('New customer');

  const [form, setForm] = useState(EMPTY);
  const { submitting, error, fieldErrors, result, submit, reset } = useSubmit(api.createCustomer);

  // A duplicate email is a 409 with no `issues[]`, so the form decides which
  // input it belongs to.
  const duplicateEmail = isApiRequestError(error) && error.status === 409;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(form);
  }

  return (
    <>
      <PageHeader
        title="New customer"
        description="Recorded in PostgreSQL. Email must be unique."
        actions={
          <Link
            to="/customers"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to customers
          </Link>
        }
      />

      <div className="max-w-2xl space-y-6">
        {result ? (
          <Callout tone="positive" title={`${result.name} was created`}>
            <p>
              {result.email} · {result.city}, {result.state}
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
              <Link to="/customers" className="inline-flex">
                <Button variant="ghost" size="sm">
                  View customers
                </Button>
              </Link>
            </p>
          </Callout>
        ) : null}

        {error !== undefined && Object.keys(fieldErrors).length === 0 && !duplicateEmail ? (
          <Callout tone="critical" title={describeError(error).title}>
            {describeError(error).message}
          </Callout>
        ) : null}

        <Card>
          <form onSubmit={onSubmit} noValidate>
            <CardBody className="space-y-5 pt-6">
              <TextField
                label="Full name"
                required
                autoComplete="name"
                value={form.name}
                error={fieldErrors.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />

              <TextField
                label="Email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                error={duplicateEmail ? describeError(error).message : fieldErrors.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  label="City"
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  error={fieldErrors.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />

                <TextField
                  label="State"
                  required
                  autoComplete="address-level1"
                  value={form.state}
                  error={fieldErrors.state}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                />
              </div>
            </CardBody>

            <CardFooter className="flex justify-end gap-2">
              <Link to="/customers" className="inline-flex">
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" loading={submitting}>
                Create customer
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}
