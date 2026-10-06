"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-16 max-w-md p-8 text-center">
      <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-danger-bg text-danger"><AlertTriangle className="size-5" /></div>
      <h2 className="text-[16px] font-semibold">Something went wrong on this page</h2>
      <p className="mt-1 text-[13px] text-fg-3">{error.message || "Unexpected error"}</p>
      <Button className="mt-5" variant="primary" onClick={reset}>Try again</Button>
    </div>
  );
}
