"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderOpen, ImagePlus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { MediaThumb, uploadFiles } from "@/components/shared/media-picker";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, EmptyState, KeyValue, Segmented, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useDebounce } from "@/hooks/use-debounce";
import { api, ApiError } from "@/lib/api";
import type { MediaItem, Paged } from "@/lib/types";
import { bytes, cn, date, number } from "@/lib/utils";

type Resp = Paged<MediaItem> & { folders: { name: string; count: number }[]; total_size: number | string };

export default function MediaPage() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const dq = useDebounce(q);
  const [folder, setFolder] = React.useState("*");
  const [kind, setKind] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [sel, setSel] = React.useState<MediaItem | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: ["media", "library", dq, folder, kind, page], placeholderData: (p) => p, queryFn: () => api.get<Resp>("/media", { q: dq, folder, kind, page, page_size: 48 }) });
  const upload = useMutation({
    mutationFn: (files: FileList | File[]) => uploadFiles(files, folder === "*" ? "" : folder),
    onSuccess: (items) => { toast.success(`Uploaded ${items.length} file(s)`); qc.invalidateQueries({ queryKey: ["media"] }); },
  });
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) upload.mutate(e.dataTransfer.files); }}>
      <PageHeader title="Media Library" description="Banners, product images, animations, videos, stickers and delivery files — reusable everywhere."
        actions={<>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,video/mp4,video/webm,.gif,.tgs,.pdf,.zip,.txt,.csv" onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
          <Button variant="primary" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload />Upload files</Button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-1">
          {[{ name: "*", count: list.data?.total ?? 0, label: "All files" }, ...(list.data?.folders ?? []).map((f) => ({ ...f, label: f.name || "Unsorted" }))].map((f) => (
            <button key={f.name + f.label} type="button" onClick={() => { setFolder(f.name); setPage(1); }}
              className={cn("flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] text-fg-2 hover:bg-hover", folder === f.name && "bg-active text-fg")}>
              {folder === f.name ? <FolderOpen className="size-4 text-accent" /> : <Folder className="size-4 text-fg-3" />}<span className="flex-1 truncate text-left">{f.label}</span>
              {f.name !== "*" ? <span className="text-[11.5px] text-fg-3">{f.count}</span> : null}
            </button>
          ))}
          <div className="px-2 pt-3 text-[11.5px] text-fg-3">{bytes(list.data?.total_size)} used</div>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <Input icon={<Search />} placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-72" />
            <Segmented value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: "", label: "All" }, { value: "image", label: "Images" }, { value: "animation", label: "GIF" }, { value: "video", label: "Video" }, { value: "document,sticker", label: "Other" }]} />
          </div>
          <div className={cn("relative rounded-[14px] transition-colors", dragging && "ring-2 ring-accent ring-offset-4 ring-offset-[var(--bg)]")}>
            {dragging ? <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[14px] bg-accent/10 text-[14px] font-medium text-accent backdrop-blur-[1px]">Drop files to upload</div> : null}
            {list.isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square h-auto" />)}</div>
            ) : !list.data?.items.length ? (
              <div className="card"><EmptyState icon={<ImagePlus />} title="No files here" description="Drag and drop files anywhere on this page, or use Upload." /></div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {list.data.items.map((m) => (
                  <button key={m.id} type="button" onClick={() => setSel(m)} className="group overflow-hidden rounded-[12px] border border-border bg-surface text-left transition-all hover:border-border-strong hover:shadow-lg">
                    <div className="relative aspect-square overflow-hidden bg-surface-2">
                      <MediaThumb media={m} className="transition-transform duration-300 group-hover:scale-[1.04]" />
                      <Badge className="absolute left-1.5 top-1.5 bg-black/60 text-white ring-0">{m.kind}</Badge>
                    </div>
                    <div className="px-2.5 py-2"><div className="truncate text-[12.5px] font-medium">{m.title}</div><div className="text-[11.5px] text-fg-3">{bytes(m.size)}{m.width ? ` · ${m.width}×${m.height}` : ""}</div></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {list.data && list.data.pages > 1 ? <div className="mt-4 flex justify-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="px-2 text-[12.5px] text-fg-3">Page {page} of {list.data.pages}</span><Button size="sm" disabled={page >= list.data.pages} onClick={() => setPage(page + 1)}>Next</Button></div> : null}
        </div>
      </div>
      {sel ? <Details media={sel} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

function Details({ media, onClose }: { media: MediaItem; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [title, setTitle] = React.useState(media.title);
  const [folder, setFolder] = React.useState(media.folder);
  const [m, setM] = React.useState(media);
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const usage = useQuery({ queryKey: ["media", "usage", media.id], queryFn: () => api.get<{ used_by: string[] }>(`/media/${media.id}/usage`) });
  const inv = () => qc.invalidateQueries({ queryKey: ["media"] });
  const update = useMutation({ mutationFn: () => api.patch<MediaItem>(`/media/${media.id}`, { title, folder }), onSuccess: (r) => { setM(r); toast.success("Saved"); inv(); } });
  const replace = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return api.upload<MediaItem>(`/media/${media.id}/replace`, fd); },
    onSuccess: (r) => { setM(r); toast.success("File replaced everywhere it's used"); inv(); },
  });
  const del = useMutation({
    mutationFn: (force: boolean) => api.del(`/media/${media.id}`, { force }),
    onSuccess: () => { toast.success("File deleted"); inv(); onClose(); },
    meta: { silent: true },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409) {
        if ((await confirm({ title: "File is in use", description: `${e.message}. Delete anyway? It will be removed from those places.`, danger: true, confirmLabel: "Delete anyway" })).ok) del.mutate(true);
      } else toast.error(e.message);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={m.title} description={m.original_name} width={480}
        footer={<>
          <Button variant="danger-ghost" className="mr-auto" onClick={async () => { if ((await confirm({ title: "Delete this file?", danger: true, confirmLabel: "Delete" })).ok) del.mutate(false); }}><Trash2 />Delete</Button>
          <input ref={replaceRef} type="file" hidden onChange={(e) => e.target.files?.[0] && replace.mutate(e.target.files[0])} />
          <Button loading={replace.isPending} onClick={() => replaceRef.current?.click()}><RefreshCw />Replace</Button>
          <Button variant="primary" loading={update.isPending} onClick={() => update.mutate()}>Save</Button>
        </>}>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[12px] border border-border bg-surface-2">
            {m.kind === "video" ? <video src={m.url} controls className="max-h-72 w-full" /> : m.kind === "image" || m.kind === "animation" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.title} className="max-h-72 w-full object-contain" />
            ) : <div className="flex h-40 items-center justify-center"><MediaThumb media={m} /></div>}
          </div>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Folder" help="Type a new name to create a folder."><Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Unsorted" /></Field>
          <div className="divide-y divide-border">
            <KeyValue label="Type">{m.mime_type}</KeyValue>
            <KeyValue label="Size">{bytes(m.size)}</KeyValue>
            {m.width ? <KeyValue label="Dimensions">{number(m.width)} × {number(m.height)} px</KeyValue> : null}
            <KeyValue label="Uploaded">{date(m.created_at)}</KeyValue>
            <KeyValue label="Version">v{m.version}</KeyValue>
            <KeyValue label="Used by">{usage.data?.used_by.length ? usage.data.used_by.join(", ") : "Not used"}</KeyValue>
          </div>
        </div>
      </SheetContent>
    </Dialog>
  );
}
