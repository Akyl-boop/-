"use client";

import { useParams } from "next/navigation";
import { SupportInbox } from "../inbox";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  return <SupportInbox selectedId={Number(id)} />;
}
