import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDataset } from '../src/api/fixtures/dataset';
import { setScenario } from '../src/api/fixtures/scenario';
import { renderApp } from './support/render';

/**
 * The operational pages, against a dataset the size of the seeded database.
 *
 * Pagination is the point here: with 10,001 orders, a page that counted the rows
 * it had rendered would be wrong on every screen.
 */

/**
 * The summary line is assembled from several spans, and Testing Library matches
 * only an element's own text nodes — so it is found by its opening words and
 * asserted on its full text content.
 */
async function paginationSummary(): Promise<HTMLElement> {
  return screen.findByText(/^Showing/);
}

describe('order history', () => {
  beforeEach(() => setScenario('ready'));

  it('counts from the API envelope, not from the rows on screen', async () => {
    renderApp('/sales');

    expect(await paginationSummary()).toHaveTextContent('Showing 1–50 of 10,001 orders');
  });

  it('pages forward without losing the total', async () => {
    const user = userEvent.setup();
    renderApp('/sales');

    await paginationSummary();
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(await paginationSummary()).toHaveTextContent('Showing 51–100 of 10,001 orders');
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
  });

  it('expands a row to reveal its line items', async () => {
    const user = userEvent.setup();
    renderApp('/sales');

    const [toggle] = await screen.findAllByRole('button', { name: /show line items/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle!);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The captured price, not today's catalogue price.
    expect(screen.getAllByText(/price at sale/i).length).toBeGreaterThan(0);
  });

  it('filters by status and offers a way back', async () => {
    const user = userEvent.setup();
    renderApp('/sales');

    await paginationSummary();
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');

    expect(await screen.findByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    expect(await paginationSummary()).not.toHaveTextContent('10,001');
  });
});

describe('customers', () => {
  beforeEach(() => setScenario('ready'));

  it('lists a page of the 501 seeded customers', async () => {
    renderApp('/customers');

    expect(await paginationSummary()).toHaveTextContent('Showing 1–50 of 501 customers');
  });

  it('links to the create form', async () => {
    renderApp('/customers');

    const link = await screen.findByRole('link', { name: /new customer/i });
    expect(link).toHaveAttribute('href', '/customers/new');
  });
});

describe('creating a customer', () => {
  beforeEach(() => setScenario('ready'));

  it('shows each API issue on the field it belongs to', async () => {
    const user = userEvent.setup();
    renderApp('/customers/new');

    // An empty submission: the API answers with one issue per field, and each
    // must land on its own input rather than in a single banner.
    await user.click(await screen.findByRole('button', { name: /create customer/i }));

    expect(await screen.findByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText(/this field is required/i).length).toBeGreaterThan(1);
  });

  it('reports a duplicate email against the email field', async () => {
    const user = userEvent.setup();
    const taken = getDataset().customers[0]?.email ?? '';
    expect(taken).not.toBe('');

    renderApp('/customers/new');

    await user.type(await screen.findByLabelText('Full name'), 'Duplicate Person');
    await user.type(screen.getByLabelText('Email'), taken);
    await user.type(screen.getByLabelText('City'), 'Pune');
    await user.type(screen.getByLabelText('State'), 'Maharashtra');

    await user.click(screen.getByRole('button', { name: /create customer/i }));

    // A 409 carries no `issues[]`, so the form decides the message belongs to
    // the email input.
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('products', () => {
  beforeEach(() => setScenario('ready'));

  it('filters the catalogue to retired products', async () => {
    const user = userEvent.setup();
    renderApp('/products');

    expect(await paginationSummary()).toHaveTextContent('of 100 products');
    await user.selectOptions(screen.getByLabelText('Filter by availability'), 'false');

    expect((await screen.findAllByText('Retired')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('marks the catalogue up as a real table with a caption', async () => {
    renderApp('/products');

    const table = await screen.findByRole('table', { name: /products with sku/i });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
  });
});
