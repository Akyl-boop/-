import type { ProductEditData } from "~/server/admin/products.server";

export type ProductDraft = ProductEditData;
export type SetDraft = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;

export interface Option {
  id: string;
  name: string;
}

export interface SectionProps {
  draft: ProductDraft;
  set: SetDraft;
}
