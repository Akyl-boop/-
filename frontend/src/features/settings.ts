"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

export type SettingsData = Record<string, Record<string, unknown>> & {
  _meta: { notification_types: Record<string, string>; groups: string[]; can_edit: boolean };
  integration_secrets: Record<string, string>;
};

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsData>("/settings") });
}

export function useSaveSettings(group: string, opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => api.put(`/settings/${group}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      if (!opts.silent) toast.success("Settings saved");
    },
  });
}
