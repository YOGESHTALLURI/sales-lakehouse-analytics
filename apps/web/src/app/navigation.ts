import {
  ChartColumn,
  Database,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** The application's sections, in one list, used by the sidebar and the router. */

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Only the index route matches exactly; the rest match their subtree. */
  readonly end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sales', label: 'Sales', icon: ShoppingCart },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/pipeline', label: 'Data Pipeline', icon: Database },
];

export const APP_NAME = 'Sales Lakehouse';
