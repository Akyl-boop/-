"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Film, ImageIcon, ImagePlus, Search, Upload, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import type { MediaItem, Paged } from "@/lib/types";
import { bytes, cn } from "@/lib/utils";

export const mediaUrl = (id: string) => `/api/media/${id}/file`;

export function MediaThumb({ media, className }: { media: Pick<MediaItem, "id" | "kind" | "url" | "mime_type"> & { title?: string }; className?: string }) {
  if (media.kind === "image" || media.kind === "animation") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.url} alt={media.title ?? ""} loading="lazy" className={cn("h-full w-full object-cover", className)} />;
  }
  if (media.kind === "video") return <video src={media.url} muted className={cn("h-full w-full object-cover", className)} />;
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-surface-3 text-fg-3", className)}>
      {media.kind === "sticker" ? <span className="text-2xl">🎴</span> : <FileText className="size-6" />}
    </div>
  );
}

export async function uploadFiles(files: FileList | File[], folder = ""): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (const f of Array.from(files)) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("folder", folder);
    out.push(await api.upload<MediaItem>("/media", fd));
  }
  return out;
}

export function MediaLibraryDialog({ open, onOpenChange, onSelect, kinds }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSelect: (m: MediaItem) => void; kinds?: string[];
}) {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const dq = useDebounce(q);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const list = useQuery({
    queryKey: ["media", "picker", dq, kinds?.join(",")], enabled: open,
    queryFn: () => api.get<Paged<MediaItem>>("/media", { q: dq, kind: kinds?.join(","), page_size: 60, folder: "*" }),
  });
  const upload = useMutation({
    mutationFn: (files: FileList) => uploadFiles(files),
    onSuccess: (items) => {
      qc.invalidateQueries({ queryKey: ["media"] });
      toast.success(`Uploaded ${items.length} file(s)`);
      if (items.length === 1) { onSelect(items[0]); onOpenChange(false); }
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Media library" description="Choose a file or upload a new one" size="lg"
        footer={<>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,video/mp4,video/webm,.gif,.tgs,.pdf,.zip,.txt"
            onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
          <Button variant="primary" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload />Upload</Button>
        </>}>
        <Input icon={<Search />} placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
        {list.isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square h-auto" />)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState icon={<ImagePlus />} title="No files yet" description="Upload JPG, PNG, WebP, GIF, MP4 or other files." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {list.data.items.map((m) => (
              <button key={m.id} type="button" onClick={() => { onSelect(m); onOpenChange(false); }}
                className="group overflow-hidden rounded-[10px] border border-border bg-surface-2 text-left transition-all hover:border-accent/60 hover:ring-2 hover:ring-accent/20">
                <div className="aspect-square overflow-hidden"><MediaThumb media={m} className="transition-transform group-hover:scale-[1.03]" /></div>
                <div className="truncate px-2 py-1.5 text-[11.5px] text-fg-2">{m.title}</div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MediaPicker({ value, onChange, kinds = ["image", "animation", "video"], label = "Choose image", className, aspect = "aspect-[16/9]" }: {
  value?: string | null; onChange: (id: string | null) => void; kinds?: string[]; label?: string; className?: string; aspect?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  const [dragging, setDragging] = React.useState(false);
  const upload = useMutation({
    mutationFn: (files: FileList) => uploadFiles(files),
    onSuccess: (items) => { qc.invalidateQueries({ queryKey: ["media"] }); if (items[0]) onChange(items[0].id); },
  });
  return (
    <div className={className}>
      {value ? (
        <div className={cn("group relative overflow-hidden rounded-[12px] border border-border bg-surface-2", aspect)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(value)} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }} />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Button size="sm" onClick={() => setOpen(true)}><ImageIcon />Replace</Button>
            <Button size="sm" variant="danger" onClick={() => onChange(null)}><X />Remove</Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) upload.mutate(e.dataTransfer.files); }}
          className={cn("flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border-strong bg-surface-2/40 p-4 text-center transition-colors", aspect,
            dragging && "border-accent bg-accent/5")}>
          {kinds.includes("video") ? <Film className="size-5 text-fg-3" /> : <ImagePlus className="size-5 text-fg-3" />}
          <div className="text-[12.5px] text-fg-3">{upload.isPending ? "Uploading…" : "Drop a file here or"}</div>
          <Button size="sm" onClick={() => setOpen(true)}>{label}</Button>
        </div>
      )}
      <MediaLibraryDialog open={open} onOpenChange={setOpen} kinds={kinds} onSelect={(m) => onChange(m.id)} />
    </div>
  );
}

export { bytes };
