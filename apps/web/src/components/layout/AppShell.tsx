import { Boxes, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { APP_NAME } from '../../app/navigation';
import { Sidebar } from './Sidebar';

/**
 * The application frame: permanent sidebar from `lg` up, an off-canvas drawer
 * below it.
 *
 * The skip link is first in the tab order because the alternative is tabbing
 * through six navigation items on every page to reach the content.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Navigating is the drawer's purpose, so completing that closes it.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-line focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-raised"
      >
        Skip to content
      </a>

      <div className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <Sidebar />
      </div>

      {/* Compact header, only where the sidebar is hidden. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="app-drawer"
          className="-ml-1 flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          <Menu aria-hidden className="size-5" />
          <span className="sr-only">Open navigation</span>
        </button>

        <span className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand">
            <Boxes aria-hidden className="size-4 text-ink-inverse" strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-ink">{APP_NAME}</span>
        </span>
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <div id="app-drawer" className="absolute inset-y-0 left-0 w-72 shadow-raised">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
            >
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close navigation</span>
            </button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <main id="main" className="px-4 py-6 sm:px-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1600px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
