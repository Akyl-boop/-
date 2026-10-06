"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Vertical drag-and-drop list (mouse, touch and keyboard). */
export function SortableList<T>({ items, getId, onReorder, render, className }: {
  items: T[]; getId: (t: T) => string | number; onReorder: (items: T[]) => void;
  render: (item: T, handle: React.ReactNode) => React.ReactNode; className?: string;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map(getId);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(e.active.id as never);
    const to = ids.indexOf(e.over.id as never);
    onReorder(arrayMove(items, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{items.map((it) => <SortableRow key={getId(it)} id={getId(it)}>{(h) => render(it, h)}</SortableRow>)}</div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string | number; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button type="button" aria-label="Drag to reorder" {...attributes} {...listeners}
      className="flex size-6 cursor-grab touch-none items-center justify-center rounded text-fg-3 hover:bg-hover hover:text-fg active:cursor-grabbing">
      <GripVertical className="size-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-90 shadow-lg")}>
      {children(handle)}
    </div>
  );
}
