"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { ProductEditor } from "../editor";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["product", Number(id)], queryFn: () => api.get<Product>(`/products/${id}`) });
  if (!q.data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-[600px]" /></div>;
  return <ProductEditor product={q.data} />;
}
