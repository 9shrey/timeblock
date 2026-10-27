import { useCallback, useRef, useState } from "react";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CLICK_SLOP = 4;

/**
 * Select-mode pointer handling for the lanes container: dragging draws a box (in container
 * coordinates) and reports the block ids it touches; a click without movement reports the
 * block under the pointer instead (or nothing, on empty space).
 */
export function useMarquee(
  lanesRef: React.RefObject<HTMLDivElement | null>,
  onSelect: (ids: string[], add: boolean, clicked: boolean) => void,
) {
  const [box, setBox] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean; add: boolean } | null>(null);

  const rel = (e: React.PointerEvent) => {
    const r = lanesRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, r };
  };

  const idsIn = (b: Box, r: DOMRect): string[] => {
    const left = Math.min(b.x0, b.x1) + r.left;
    const right = Math.max(b.x0, b.x1) + r.left;
    const top = Math.min(b.y0, b.y1) + r.top;
    const bottom = Math.max(b.y0, b.y1) + r.top;
    const ids: string[] = [];
    lanesRef.current!.querySelectorAll<HTMLElement>('[data-item="block"]').forEach((el) => {
      const q = el.getBoundingClientRect();
      if (q.left < right && q.right > left && q.top < bottom && q.bottom > top) ids.push(el.dataset.id!);
    });
    return ids;
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !lanesRef.current) return;
    e.preventDefault(); // no focus/selection side effects on blocks
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = rel(e);
    start.current = { x, y, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s || !lanesRef.current) return;
    const { x, y } = rel(e);
    if (!s.moved && Math.hypot(x - s.x, y - s.y) < CLICK_SLOP) return;
    s.moved = true;
    setBox({ x0: s.x, y0: s.y, x1: x, y1: y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      setBox(null);
      if (!s || !lanesRef.current) return;
      const { x, y, r } = rel(e);
      if (s.moved) onSelect(idsIn({ x0: s.x, y0: s.y, x1: x, y1: y }, r), s.add, false);
      else onSelect(idsIn({ x0: x, y0: y, x1: x + 1, y1: y + 1 }, r), true, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelect],
  );

  const cancel = useCallback(() => {
    start.current = null;
    setBox(null);
  }, []);

  return { box, handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: cancel } };
}
