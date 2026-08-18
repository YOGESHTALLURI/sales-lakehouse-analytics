import { Boxes } from 'lucide-react';
import { NavLink } from 'react-router';
import { APP_NAME, NAV_ITEMS } from '../../app/navigation';
import { WarehouseIndicator } from '../../features/pipeline/WarehouseIndicator';
import { cx } from '../../lib/cx';

/**
 * Primary navigation.
 *
 * `NavLink` sets `aria-current="page"` on the active route, so the highlight is
 * not the only way to know where you are.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col border-r border-line bg-surface">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand">
          <Boxes aria-hidden className="size-[18px] text-ink-inverse" strokeWidth={2} />
        </span>
        <span className="text-base font-semibold tracking-tight text-ink">{APP_NAME}</span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-surface text-brand'
                      : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden
                      className={cx('size-[18px]', isActive ? 'text-brand' : 'text-ink-muted')}
                      strokeWidth={1.75}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        <WarehouseIndicator />
      </div>
    </div>
  );
}
