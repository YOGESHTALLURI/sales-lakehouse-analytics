import { CalendarDays } from 'lucide-react';
import { RANGE_PRESETS, type RangePresetId } from '../../lib/dateRange';

const OPTIONS = RANGE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }));

/**
 * The reporting window control.
 *
 * A native `<select>` rather than a custom popover: it is keyboard and
 * screen-reader correct with no work, and uses the platform's own picker on
 * touch devices.
 */
export function RangeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: RangePresetId;
  onChange: (value: RangePresetId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <CalendarDays
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
      />
      <select
        aria-label="Reporting window"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (RANGE_PRESETS.some((preset) => preset.id === next)) onChange(next as RangePresetId);
        }}
        className="h-10 rounded-lg border border-line bg-surface pl-9 pr-8 text-sm font-medium text-ink-soft hover:border-line-strong disabled:cursor-not-allowed disabled:bg-surface-sunken"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
