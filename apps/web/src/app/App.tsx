import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from '../components/layout/AppShell';
import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { CustomersPage } from '../features/customers/CustomersPage';
import { NewCustomerPage } from '../features/customers/NewCustomerPage';
import { NewOrderPage } from '../features/orders/NewOrderPage';
import { OrdersPage } from '../features/orders/OrdersPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { PipelinePage } from '../features/pipeline/PipelinePage';
import { PipelineProvider } from '../features/pipeline/PipelineProvider';
import { NewProductPage } from '../features/products/NewProductPage';
import { ProductsPage } from '../features/products/ProductsPage';
import { NotFoundPage } from './NotFoundPage';

/**
 * The route table.
 *
 * Exported apart from the router so tests can mount it inside a `MemoryRouter`
 * and drive navigation without touching browser history.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />

        <Route path="sales" element={<OrdersPage />} />
        <Route path="sales/new" element={<NewOrderPage />} />

        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<NewCustomerPage />} />

        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<NewProductPage />} />

        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="pipeline" element={<PipelinePage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {/* Above the routes: the sidebar indicator and the dashboard both read this
          one polling loop, and a route change must not restart it. */}
      <PipelineProvider>
        <AppRoutes />
      </PipelineProvider>
    </BrowserRouter>
  );
}
