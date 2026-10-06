"use client";

import { Image as ImageIcon, LayoutGrid, MessageSquareText, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useUrlState } from "@/hooks/use-url-state";
import { AppearanceTab } from "./appearance";
import { BannersTab } from "./banners";
import { MenuBuilder } from "./menu-builder";
import { TextsTab } from "./texts";

export default function BotEditorPage() {
  const [f, setF] = useUrlState({ tab: "texts" });
  return (
    <div>
      <PageHeader title="Bot Editor" description="Change every text, button, emoji, banner and menu of your bot — no code, instant updates, live preview." />
      <Tabs value={f.tab} onValueChange={(v) => setF({ tab: v })}>
        <TabsList className="mb-4">
          <TabsTrigger value="texts"><MessageSquareText />Texts & translations</TabsTrigger>
          <TabsTrigger value="menu"><LayoutGrid />Menu builder</TabsTrigger>
          <TabsTrigger value="banners"><ImageIcon />Banners</TabsTrigger>
          <TabsTrigger value="appearance"><SlidersHorizontal />Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="texts"><TextsTab /></TabsContent>
        <TabsContent value="menu"><MenuBuilder /></TabsContent>
        <TabsContent value="banners"><BannersTab /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
