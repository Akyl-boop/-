import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";

export function Pagination({ page, pageCount, total }: { page: number; pageCount: number; total: number }) {
  const location = useLocation();
  const t = useT();
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const params = new URLSearchParams(location.search);
    params.set("page", String(target));
    return `${location.pathname}?${params.toString()}`;
  };
  const item = "btn btn-secondary btn-sm btn-icon";
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Pagination">
      <p className="text-xs text-fg-subtle tabular">{t("common.pageOf", { page, pages: pageCount, total })}</p>
      <div className="flex items-center gap-1.5">
        <Link to={href(page - 1)} className={cn(item, page <= 1 && "pointer-events-none opacity-40")} aria-disabled={page <= 1} aria-label={t("common.previous")}>
          <ChevronLeft className="size-4" />
        </Link>
        <Link to={href(page + 1)} className={cn(item, page >= pageCount && "pointer-events-none opacity-40")} aria-disabled={page >= pageCount} aria-label={t("common.next")}>
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </nav>
  );
}
