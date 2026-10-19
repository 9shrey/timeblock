import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  createBlockAt,
  createDefaultAt,
  intervalOfRef,
  materialize,
  moveBlockTo,
  resizeOrSplitAtMidnight,
  select,
} from "@/state/commands";
import { useStore } from "@/state/store";
import { closeEditor, openEditor, useUi } from "@/state/ui";
import { BlockContextMenu } from "./BlockContextMenu";
import { BlockPopover } from "./BlockPopover";
import type { DragCtx, DragEffect, ItemRef } from "./dragMachine";
import { isEditable, minuteAt, minutesToPx, type ColumnSpec } from "./geometry";
import { LaneColumn } from "./LaneColumn";
import { TimeGutter } from "./TimeGutter";
import { targetFromElement, useDrag } from "./useDrag";

interface Props {
  columns: readonly ColumnSpec[];
  pxPerHour: number;
  /** Header cell rendered above each column (ignored when `header` is given). */
  renderHeader?: (col: ColumnSpec, index: number) => React.ReactNode;
  /** A custom header row (after the gutter spacer), e.g. one cell per day. */
  header?: React.ReactNode;
  /** Minute to scroll to whenever `scrollKey` changes. */
  initialMinute: number;
  scrollKey: string;
}

const sameRef = (a: ItemRef, b: ItemRef) =>
  a.kind === b.kind && (a.kind === "block" ? a.id === (b as { id: string }).id : a.planBlockId === (b as { planBlockId: string }).planBlockId);

export function Timeline({ columns, pxPerHour, renderHeader, header, initialMinute, scrollKey }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef(columns);
  useLayoutEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  const nowDay = useStore((s) => s.now.day);
  const nowMinute = useStore((s) => s.now.minute);
  const showNow = columns.some((c) => c.day === nowDay);

  // Scroll once per view/day change, not on every render.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = Math.max(0, minutesToPx(initialMinute, pxPerHour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, pxPerHour]);

  const getCtx = useCallback(
    (): DragCtx => ({ columns: columnsRef.current, snap: useStore.getState().settings.snapMinutes, intervalOf: intervalOfRef }),
    [],
  );

  const onEffect = useCallback((e: DragEffect) => {
    const cols = columnsRef.current;
    switch (e.type) {
      case "click": {
        const editing = useUi.getState().editing;
        if (e.target.type === "empty") {
          select(null);
          closeEditor();
        } else {
          if (editing && !sameRef(editing.ref, e.target.ref)) closeEditor();
          select(e.target.ref);
        }
        return;
      }
      case "blocked": {
        const c = cols[e.col];
        toast(c?.locked ? "This day's plan is locked. Click the lock icon to edit it." : "You can't log time in the future.");
        return;
      }
      case "create": {
        const c = cols[e.col];
        if (c) createBlockAt(c.day, c.layer, e.start, e.end);
        return;
      }
      case "move": {
        const c = cols[e.col];
        if (c) moveBlockTo(e.id, c.day, e.start, e.end, e.copy);
        return;
      }
      case "resize":
        resizeOrSplitAtMidnight(e.id, e.start, e.end, e.overflowMinutes);
        return;
      case "materialize":
        materialize(e.planBlockId, { startMinute: e.start, endMinute: e.end });
        return;
    }
  }, []);

  const { handlers } = useDrag({ lanesRef, scrollerRef, pxPerHour, getCtx, onEffect });

  // Pointer capture retargets click/dblclick to the lanes container: hit-test the point instead.
  const onDoubleClick = (e: React.MouseEvent) => {
    const { target, ref } = targetFromElement(document.elementFromPoint(e.clientX, e.clientY));
    if (!target) return;
    if (ref) {
      select(ref);
      openEditor(ref);
      return;
    }
    const c = columnsRef.current[target.col];
    if (c && isEditable(c) && lanesRef.current) {
      createDefaultAt(c.day, c.layer, minuteAt(e.clientY, lanesRef.current.getBoundingClientRect().top, pxPerHour));
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const { target, ref } = targetFromElement(e.target as Element);
    if (!target || !lanesRef.current) {
      e.preventDefault(); // Radix won't open an (empty) menu
      useUi.setState({ menu: null });
      return;
    }
    const minute = minuteAt(e.clientY, lanesRef.current.getBoundingClientRect().top, pxPerHour);
    if (ref) select(ref);
    useUi.setState({ menu: ref ? { kind: "item", ref, col: target.col, minute } : { kind: "empty", col: target.col, minute } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 overflow-y-hidden border-b [scrollbar-gutter:stable]">
        <div className="w-12 shrink-0" />
        {header ??
          columns.map((c, i) => (
            <div key={c.key} className="min-w-0 flex-1 border-l" style={{ flexGrow: c.span ?? 1 }}>
              {renderHeader?.(c, i)}
            </div>
          ))}
      </div>
      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="relative flex" style={{ height: minutesToPx(1440, pxPerHour) }}>
          <TimeGutter pxPerHour={pxPerHour} nowMinute={showNow ? nowMinute : null} />
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={lanesRef}
                className="relative flex min-w-0 flex-1 touch-none select-none"
                onDoubleClick={onDoubleClick}
                onContextMenu={onContextMenu}
                {...handlers}
              >
                {columns.map((c, i) => (
                  <LaneColumn key={c.key} spec={c} index={i} pxPerHour={pxPerHour} />
                ))}
              </div>
            </ContextMenuTrigger>
            <BlockContextMenu columns={columns} />
          </ContextMenu>
        </div>
      </div>
      <BlockPopover />
    </div>
  );
}
