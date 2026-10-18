/**
 * Wires pointer events on the lanes container to the pure `dragMachine`. Machine state lives
 * in a ref; the draft goes to a tiny store that only `DraftLayer` reads.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { setDraft } from "@/state/draft";
import { draftOf, IDLE, reduce, type DragCtx, type DragEffect, type DragState, type DragTarget, type ItemRef } from "./dragMachine";
import { columnAt, minuteAt, type ColumnRect } from "./geometry";

const AUTOSCROLL_EDGE = 48;
const AUTOSCROLL_MAX = 18;

/** Resolves what a pointer event landed on from data attributes. */
export function targetFromElement(el: Element | null): { target: DragTarget | null; ref: ItemRef | null } {
  const colEl = el?.closest<HTMLElement>("[data-col]");
  if (!el || !colEl || el.closest("[data-nodrag]")) return { target: null, ref: null };
  const col = Number(colEl.dataset.col);
  const itemEl = el.closest<HTMLElement>("[data-item]");
  if (!itemEl) return { target: { type: "empty", col }, ref: null };
  const id = itemEl.dataset.id!;
  const ref: ItemRef = itemEl.dataset.item === "ghost" ? { kind: "ghost", planBlockId: id } : { kind: "block", id };
  const edge = el.closest<HTMLElement>("[data-edge]")?.dataset.edge as "start" | "end" | undefined;
  return { target: edge ? { type: "edge", ref, edge, col } : { type: "item", ref, col }, ref };
}

interface Options {
  lanesRef: React.RefObject<HTMLDivElement | null>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  pxPerHour: number;
  getCtx: () => DragCtx;
  onEffect: (effect: DragEffect) => void;
}

export function useDrag({ lanesRef, scrollerRef, pxPerHour, getCtx, onEffect }: Options) {
  const state = useRef<DragState>(IDLE);
  const rects = useRef<ColumnRect[]>([]);
  const last = useRef<{ x: number; y: number; shift: boolean; ctrl: boolean } | null>(null);
  const raf = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);

  const dispatch = useCallback(
    (e: Parameters<typeof reduce>[1]) => {
      const step = reduce(state.current, e, getCtx());
      state.current = step.state;
      setDraft(draftOf(step.state));
      if (step.effect) onEffect(step.effect);
    },
    [getCtx, onEffect],
  );

  const minute = useCallback(
    (clientY: number) => minuteAt(clientY, lanesRef.current!.getBoundingClientRect().top, pxPerHour),
    [lanesRef, pxPerHour],
  );

  const sendMove = useCallback(() => {
    const p = last.current;
    if (!p || !lanesRef.current) return;
    dispatch({ type: "move", x: p.x, y: p.y, minute: minute(p.y), col: columnAt(p.x, rects.current), shift: p.shift, ctrl: p.ctrl });
  }, [dispatch, lanesRef, minute]);

  const stopAutoscroll = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  // Held in a ref so the rAF loop can schedule itself.
  const autoscroll = useRef<() => void>(() => {});
  const step = useCallback(() => {
    raf.current = null;
    const scroller = scrollerRef.current;
    const p = last.current;
    if (!scroller || !p || state.current.kind !== "active") return;
    const r = scroller.getBoundingClientRect();
    const dTop = p.y - r.top;
    const dBottom = r.bottom - p.y;
    let dy = 0;
    if (dTop < AUTOSCROLL_EDGE) dy = -AUTOSCROLL_MAX * (1 - Math.max(0, dTop) / AUTOSCROLL_EDGE) ** 2;
    else if (dBottom < AUTOSCROLL_EDGE) dy = AUTOSCROLL_MAX * (1 - Math.max(0, dBottom) / AUTOSCROLL_EDGE) ** 2;
    if (dy !== 0) {
      scroller.scrollTop += dy;
      sendMove();
      raf.current = requestAnimationFrame(autoscroll.current);
    }
  }, [scrollerRef, sendMove]);
  useLayoutEffect(() => {
    autoscroll.current = step;
  }, [step]);

  const finish = useCallback(() => {
    stopAutoscroll();
    last.current = null;
    if (pointerId.current !== null && lanesRef.current?.hasPointerCapture(pointerId.current)) {
      lanesRef.current.releasePointerCapture(pointerId.current);
    }
    pointerId.current = null;
  }, [lanesRef]);

  const cancel = useCallback(() => {
    if (state.current.kind === "idle") return;
    dispatch({ type: "cancel" });
    finish();
  }, [dispatch, finish]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || state.current.kind !== "idle" || !lanesRef.current) return;
      const { target } = targetFromElement(e.target as Element);
      if (!target) return;
      rects.current = [...lanesRef.current.querySelectorAll<HTMLElement>("[data-col-key]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      pointerId.current = e.pointerId;
      lanesRef.current.setPointerCapture(e.pointerId);
      last.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      dispatch({ type: "down", target, x: e.clientX, y: e.clientY, minute: minute(e.clientY) });
    },
    [dispatch, lanesRef, minute],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (state.current.kind === "idle" || e.pointerId !== pointerId.current) return;
      last.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      sendMove();
      if (state.current.kind === "active" && raf.current === null) raf.current = requestAnimationFrame(autoscroll.current);
    },
    [sendMove],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (state.current.kind === "idle" || e.pointerId !== pointerId.current) return;
      last.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      if (state.current.kind === "active") sendMove();
      dispatch({ type: "up", ctrl: e.ctrlKey || e.metaKey });
      finish();
    },
    [dispatch, finish, sendMove],
  );

  // Esc cancels; Shift/Ctrl changes recompute the draft (fine snap / copy).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.current.kind === "idle") return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      } else if ((e.key === "Shift" || e.key === "Control") && last.current) {
        last.current = { ...last.current, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        sendMove();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [cancel, sendMove]);

  // Wheel scrolling during a drag moves the content under the pointer: recompute.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (state.current.kind === "active") sendMove();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollerRef, sendMove]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel, onLostPointerCapture: cancel },
    isDragging: () => state.current.kind === "active",
  };
}
