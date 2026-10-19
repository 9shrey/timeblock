import { useState } from "react";

/**
 * Native HTML5 drag-to-reorder for a flat list, ids-based. Drag the handle (spread
 * `dragHandleProps` onto it); drop anywhere on the target row (`dropZoneProps`) to move
 * the dragged id to that position. Calls `onReorder` with the ids in their new order.
 */
export function useDragReorder(ids: readonly string[], onReorder: (orderedIds: string[]) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function dragHandleProps(id: string): React.HTMLAttributes<HTMLButtonElement> {
    return {
      draggable: true,
      onDragStart: (e) => {
        setDraggedId(id);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => {
        setDraggedId(null);
        setOverId(null);
      },
    };
  }

  function dropZoneProps(id: string): React.HTMLAttributes<HTMLElement> {
    return {
      onDragOver: (e) => {
        if (!draggedId || draggedId === id) return;
        e.preventDefault();
        setOverId(id);
      },
      onDragLeave: () => setOverId((cur) => (cur === id ? null : cur)),
      onDrop: (e) => {
        e.preventDefault();
        setOverId(null);
        if (!draggedId || draggedId === id) return;
        const from = ids.indexOf(draggedId);
        const to = ids.indexOf(id);
        if (from === -1 || to === -1) return;
        const next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, draggedId);
        onReorder(next);
        setDraggedId(null);
      },
    };
  }

  return { dragHandleProps, dropZoneProps, isDragOver: (id: string) => overId === id };
}
