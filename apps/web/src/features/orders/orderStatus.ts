import type { BadgeTone } from '../../components/ui/Badge';
import { ORDER_STATUSES, type OrderStatus } from '../../api/types';

/**
 * How each order status is written and coloured, defined once.
 *
 * `cancelled` is caution rather than critical: a cancelled order is a normal
 * business outcome, not a failure of the system.
 */

interface StatusPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
}

const PRESENTATION: Readonly<Record<OrderStatus, StatusPresentation>> = {
  pending: { label: 'Pending', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'brand' },
  shipped: { label: 'Shipped', tone: 'brand' },
  delivered: { label: 'Delivered', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'caution' },
};

export function orderStatusLabel(status: OrderStatus): string {
  return PRESENTATION[status].label;
}

export function orderStatusTone(status: OrderStatus): BadgeTone {
  return PRESENTATION[status].tone;
}

export const ORDER_STATUS_OPTIONS = ORDER_STATUSES.map((status) => ({
  value: status,
  label: PRESENTATION[status].label,
}));

export function isOrderStatus(value: string | null | undefined): value is OrderStatus {
  return ORDER_STATUSES.some((status) => status === value);
}
