"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn, number } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox, EmptyState, Skeleton } from "./misc";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hide below this breakpoint (tables adapt on smaller screens). */
  hide?: "sm" | "md" | "lg" | "xl";
  sortKey?: string;
  align?: "left" | "right" | "center";
}

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

export function DataTable<T>({
  rows, columns, loading, getId, onRowClick, empty, selected, onSelectedChange, sort, onSort, page, pages, total,
  onPage, mobileCard, className, dense,
}: {
  rows: T[] | undefined; columns: Column<T>[]; loading?: boolean; getId: (r: T) => string | number;
  onRowClick?: (r: T) => void; empty?: React.ReactNode; selected?: Set<string | number>;
  onSelectedChange?: (s: Set<string | number>) => void; sort?: string; onSort?: (s: string) => void;
  page?: number; pages?: number; total?: number; onPage?: (p: number) => void;
  mobileCard?: (r: T) => React.ReactNode; className?: string; dense?: boolean;
}) {
  const list = rows ?? [];
  const selectable = !!onSelectedChange && !!selected;
  const allSelected = selectable && list.length > 0 && list.every((r) => selected!.has(getId(r)));
  const someSelected = selectable && list.some((r) => selected!.has(getId(r)));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) list.forEach((r) => next.delete(getId(r)));
    else list.forEach((r) => next.add(getId(r)));
    onSelectedChange!(next);
  };
  const toggle = (id: string | number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange!(next);
  };

  const showEmpty = !loading && list.length === 0;

  return (
    <div className={cn("overflow-hidden rounded-[14px] border border-border bg-surface", className)}>
      {mobileCard ? (
        <div className="divide-y divide-border sm:hidden">
          {loading && !list.length
            ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-2 p-4"><Skeleton className="w-1/2" /><Skeleton className="w-1/3" /></div>)
            : list.map((r) => (
              <div key={getId(r)} onClick={() => onRowClick?.(r)} className={cn("p-4", onRowClick && "cursor-pointer active:bg-hover")}>
                {mobileCard(r)}
              </div>
            ))}
        </div>
      ) : null}
      <div className={cn("overflow-x-auto", mobileCard && "hidden sm:block")}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-2/40">
              {selectable ? (
                <th className="w-10 px-4">
                  <Checkbox aria-label="Select all" checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} />
                </th>
              ) : null}
              {columns.map((c) => {
                const active = sort && c.sortKey && sort.replace(/^-/, "") === c.sortKey;
                const desc = active && sort!.startsWith("-");
                return (
                  <th key={c.key}
                    className={cn("h-9 whitespace-nowrap px-4 text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-fg-3",
                      c.align === "right" && "text-right", c.align === "center" && "text-center", c.hide && hideCls[c.hide], c.headerClassName)}>
                    {c.sortKey && onSort ? (
                      <button type="button" className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
                        onClick={() => onSort(active && !desc ? `-${c.sortKey}` : active && desc ? c.sortKey! : `-${c.sortKey}`)}>
                        {c.header}
                        {active ? (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : null}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && !list.length
              ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {selectable ? <td className="px-4"><Skeleton className="size-4" /></td> : null}
                  {columns.map((c, j) => (
                    <td key={c.key} className={cn("px-4", dense ? "py-2" : "py-3", c.hide && hideCls[c.hide])}>
                      <Skeleton className={cn(j === 0 ? "w-28" : "w-16", "h-3.5")} />
                    </td>
                  ))}
                </tr>
              ))
              : list.map((r) => {
                const id = getId(r);
                const isSel = selectable && selected!.has(id);
                return (
                  <tr key={id} onClick={() => onRowClick?.(r)}
                    className={cn("group border-b border-border transition-colors last:border-0", onRowClick && "cursor-pointer hover:bg-hover",
                      isSel && "bg-accent/[0.06]")}>
                    {selectable ? (
                      <td className="px-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label="Select row" checked={!!isSel} onCheckedChange={() => toggle(id)} />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td key={c.key}
                        className={cn("px-4 align-middle text-fg", dense ? "py-2" : "py-2.5", c.align === "right" && "text-right tabular",
                          c.align === "center" && "text-center", c.hide && hideCls[c.hide], c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {showEmpty ? (empty ?? <EmptyState title="Nothing here yet" description="Try adjusting your filters." />) : null}
      {onPage && pages && pages > 0 && (total ?? 0) > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[12.5px] text-fg-3">
          <span className="tabular">{number(total)} {total === 1 ? "result" : "results"}</span>
          <div className="flex items-center gap-1">
            <span className="mr-2 tabular">Page {page} of {pages}</span>
            <Button size="icon-sm" variant="ghost" disabled={(page ?? 1) <= 1} onClick={() => onPage((page ?? 1) - 1)} aria-label="Previous page"><ChevronLeft /></Button>
            <Button size="icon-sm" variant="ghost" disabled={(page ?? 1) >= pages} onClick={() => onPage((page ?? 1) + 1)} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
