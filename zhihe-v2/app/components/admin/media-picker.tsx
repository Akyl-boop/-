import { ImageIcon, ImagePlus, Link2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";
import { uploadImage } from "~/lib/image-upload";

interface MediaItem {
  id: string;
  url: string;
  filename: string;
}

export function useImageUpload(onUploaded: (url: string) => void) {
  const [uploading, setUploading] = useState(false);
  const toast = useToast();
  const t = useT();
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadImage(file);
      if ("url" in result) onUploaded(result.url);
      else toast({ tone: "error", title: t("admin.media.uploadFailed"), description: t(`admin.media.error.${result.error}` as never) });
    } catch {
      toast({ tone: "error", title: t("admin.media.uploadFailed") });
    } finally {
      setUploading(false);
    }
  };
  return { upload, uploading };
}

export function MediaLibraryDialog({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (url: string) => void }) {
  const t = useT();
  const fetcher = useFetcher<{ items: MediaItem[] }>();
  useEffect(() => {
    if (open && fetcher.state === "idle" && !fetcher.data) fetcher.load("/admin/media?picker=1");
  }, [open, fetcher]);
  const items = fetcher.data?.items ?? [];
  return (
    <Dialog open={open} onClose={onClose} title={t("admin.media.library")} size="lg">
      {fetcher.state === "loading" && !fetcher.data ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="skeleton aspect-square rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">{t("admin.media.empty")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.url);
                onClose();
              }}
              className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-panel-2 transition-colors hover:border-accent"
            >
              <img src={item.url} alt={item.filename} loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Single image field: upload, pick from the library, or paste a URL. */
export function MediaPicker({ value, onChange, label, aspect = "aspect-[16/10]" }: { value: string | null; onChange: (url: string | null) => void; label?: string; aspect?: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const { upload, uploading } = useImageUpload((url) => onChange(url));

  return (
    <div>
      {label ? <span className="field-label">{label}</span> : null}
      <div className={cn("group relative overflow-hidden rounded-xl border border-dashed border-line-strong bg-panel-2/50", aspect)}>
        {value ? (
          <>
            <img src={value} alt="" className="size-full object-cover" />
            <button type="button" onClick={() => onChange(null)} className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={t("common.remove")}>
              <X className="size-4" />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 text-fg-subtle transition-colors hover:text-fg">
            <ImagePlus className="size-6" />
            <span className="text-xs">{uploading ? t("admin.media.uploading") : t("admin.media.drop")}</span>
          </button>
        )}
        {uploading ? <div className="skeleton absolute inset-0 rounded-none" /> : null}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" onChange={(event) => upload(event.target.files?.[0]).then(() => (event.target.value = ""))} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => input.current?.click()} loading={uploading}>
          <Upload className="size-3.5" />
          {t("admin.media.upload")}
        </Button>
        <Button size="sm" onClick={() => setLibrary(true)}>
          <ImageIcon className="size-3.5" />
          {t("admin.media.library")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setUrlMode((mode) => !mode)}>
          <Link2 className="size-3.5" />
          URL
        </Button>
      </div>
      {urlMode ? (
        <input
          className="input input-sm mt-2"
          placeholder="https://…"
          defaultValue={value ?? ""}
          onBlur={(event) => {
            const url = event.target.value.trim();
            if (!url) return onChange(null);
            if (/^(https:\/\/|\/)/.test(url)) onChange(url);
          }}
        />
      ) : null}
      <MediaLibraryDialog open={library} onClose={() => setLibrary(false)} onSelect={(url) => onChange(url)} />
    </div>
  );
}
