import type { WeekStartDay } from "@/domain/types";

const SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday toggles in the user's week order. `value` uses bit d = weekday d (0 = Sunday). */
export function WeekdayPicker({
  value,
  onChange,
  weekStartDay,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  weekStartDay: WeekStartDay;
  label: string;
}) {
  const order = Array.from({ length: 7 }, (_, i) => (weekStartDay + i) % 7);
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {order.map((bit) => {
        const on = (value & (1 << bit)) !== 0;
        return (
          <button
            key={bit}
            type="button"
            aria-pressed={on}
            aria-label={LONG[bit]}
            title={LONG[bit]}
            onClick={() => onChange(value ^ (1 << bit))}
            className="flex size-8 items-center justify-center rounded-full border text-xs data-[on=true]:bg-primary data-[on=true]:text-primary-foreground"
            data-on={on}
          >
            {SHORT[bit]}
          </button>
        );
      })}
    </div>
  );
}
