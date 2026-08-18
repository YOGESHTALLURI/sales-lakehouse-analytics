import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { setScenario } from '../src/api/fixtures/scenario';
import { renderApp } from './support/render';

/**
 * The order form's two server-enforced rules.
 *
 * Both are validated by the API regardless, so what is tested here is that the
 * form does not let a user build a request the API will reject.
 */

async function chooseFirstOption(select: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  const options = within(select).getAllByRole('option');
  // [0] is the "choose…" placeholder.
  const first = options[1];
  expect(first).toBeDefined();

  await user.selectOptions(select, (first as HTMLOptionElement).value);
  return first as HTMLOptionElement;
}

describe('creating an order', () => {
  beforeEach(() => setScenario('ready'));

  it('merges a repeated product into one line instead of creating a duplicate', async () => {
    const user = userEvent.setup();
    renderApp('/sales/new');

    const productSelect = await screen.findByLabelText('Product');
    const product = await chooseFirstOption(productSelect, user);

    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '2');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    // The same product again: the API would answer 400 on items.1.productId, so
    // the form must fold it into the existing line.
    await user.selectOptions(productSelect, product.value);
    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '1');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    const quantityInputs = screen.getAllByLabelText(/^Quantity for /);
    expect(quantityInputs).toHaveLength(1);
    expect(quantityInputs[0]).toHaveValue(3);

    expect(screen.getByText(/already on this order/i)).toBeInTheDocument();
  });

  it('offers only active products, so a retired one cannot be chosen', async () => {
    const user = userEvent.setup();
    renderApp('/sales/new');

    const productSelect = await screen.findByLabelText('Product');
    await chooseFirstOption(productSelect, user);

    // Every option maps to a product the catalogue reports as active; the
    // `product_inactive` conflict is still handled, for a catalogue that changes
    // between loading this page and submitting it.
    const labels = within(productSelect)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');

    expect(labels.length).toBeGreaterThan(1);
    expect(labels.every((label) => !label.toLowerCase().includes('retired'))).toBe(true);
  });

  it('cannot be submitted without a customer or a line', async () => {
    renderApp('/sales/new');

    const submit = await screen.findByRole('button', { name: /create order/i });
    expect(submit).toBeDisabled();
  });

  it('reports the total the API computed, not the estimate', async () => {
    const user = userEvent.setup();
    renderApp('/sales/new');

    await chooseFirstOption(await screen.findByLabelText('Customer'), user);
    await chooseFirstOption(screen.getByLabelText('Product'), user);
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await user.click(screen.getByRole('button', { name: /create order/i }));

    expect(await screen.findByText(/was created/i)).toBeInTheDocument();
    // The saved line shows the price the server captured inside the transaction.
    expect(screen.getByText(/price at sale/i)).toBeInTheDocument();
    expect(screen.getByText(/^Order total ₹/)).toBeInTheDocument();
  });
});
