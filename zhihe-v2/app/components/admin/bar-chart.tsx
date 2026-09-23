import { useState } from "react";
import { cn } from "~/lib/format";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * base) return step * base;
  return 10 * base;
}

/**
 * Single-series column chart: ≤24px columns with a 4px rounded cap anchored to the
 * baseline, a 2px gap between neighbours, hairline grid, hover tooltip and an
 * equivalent data table for assistive tech.
 */
export function BarChart({ data, format, title, height = 220 }: { data: BarDatum[]; format: (value: number) => string; title: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((datum) => datum.value), 0));
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0];
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const current = active !== null ? data[active] : null;

  return (
    <figure className="w-full">
      <div className="flex gap-3" style={{ height }}>
        <div className="flex w-14 shrink-0 flex-col justify-between pb-6 text-right text-[11px] text-fg-subtle tabular" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {format(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden="true">
            {ticks.map((tick) => (
              <div key={tick} className="h-px bg-line" />
            ))}
          </div>
          <div className="absolute inset-x-0 top-0 bottom-6 flex items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
            {data.map((datum, index) => {
              const ratio = datum.value / max;
              return (
                <div
                  key={datum.key}
                  className="group relative flex h-full flex-1 cursor-default items-end justify-center"
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  aria-label={`${datum.label}: ${format(datum.value)}`}
                >
                  <div
                    className={cn("w-full max-w-6 rounded-t-[4px] transition-[background-color,height] duration-300", active === index ? "bg-accent-strong" : "bg-accent/80")}
                    style={{ height: datum.value > 0 ? `max(${ratio * 100}%, 3px)` : "0px" }}
                  />
                </div>
              );
            })}
          </div>
          {current && active !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 animate-pop rounded-lg border border-line-strong bg-panel-2 px-3 py-2 text-xs whitespace-nowrap"
              style={{ left: `${((active + 0.5) / data.length) * 100}%`, boxShadow: "var(--shadow-pop)" }}
            >
              <p className="text-fg-subtle">{current.label}</p>
              <p className="mt-0.5 font-semibold text-fg tabular">{format(current.value)}</p>
              {current.detail ? <p className="text-fg-muted">{current.detail}</p> : null}
            </div>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 flex h-5 gap-[2px] text-[11px] text-fg-subtle" aria-hidden="true">
            {data.map((datum, index) => (
              <span key={datum.key} className="flex-1 overflow-visible text-center whitespace-nowrap">
                {index % labelEvery === 0 ? datum.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>{format(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
