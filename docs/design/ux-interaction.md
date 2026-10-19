# UX and Interaction Spec: time-blocking app with Plan vs Actual columns and weekly goals

Target: Tauri 2 + React + TypeScript + Vite, desktop, local-first. The spec is sized for a 1280×800 window, with a minimum window size of 960×640.

---

## 0. Core concepts (shared vocabulary)

| Term | Meaning |
|---|---|
| **Lane** | Each day has two lanes: `plan` and `actual`. A block belongs to exactly one lane. |
| **Plan block** | Intent. Has `review_state`: `pending` or `skipped`. "Done" is never stored; it is derived from whether a linked actual block exists. |
| **Actual block** | Fact. Has an optional `plan_block_id` link. Many actual blocks can point to one plan block (for example, a plan block split by an interruption). |
| **Ghost** | A virtual, unstored mirror of a `pending` plan block that has no linked actual. It is drawn in the Actual lane. This is how "Actual starts as a copy of the plan" is delivered without writing stale copies to the DB. If the plan changes before review, the ghosts follow it automatically. |
| **Materialize** | Any edit to a ghost (drag, resize, retitle, "as planned") creates a real actual block linked to the plan block, and the ghost disappears. Deleting a ghost sets the plan block to `skipped`. |
| **Carve** | The Actual lane is *exclusive* (reality has no overlaps). When you commit an actual block, it trims or splits whatever confirmed actual blocks it overlaps. Ghosts are a background layer and are never carved. When a ghost is confirmed, its interval minus the existing confirmed actual time becomes 0..n linked actual pieces. |
| **Goal** | A persistent tag with a color, a default target and a kind (`min` ≥, `max` ≤, `none` = tracked only). Per-week targets can override the default. Each week has its own outcome checklist per goal. |

**Why ghosts plus carve:** a heavy user's correction flow at the end of the day is: (1) draw the interruptions and unplanned things over the ghosts, (2) delete the ghosts that didn't happen, (3) press **Confirm rest as planned**. The ghosts then fill exactly the gaps around what you drew. Correcting a typical day takes 3–6 actions.

**Deletion rules:**
- Deleting the last linked actual of a plan block sets that plan block to `skipped`, so its ghost does not reappear.
- Undo restores everything.
- "Confirm rest as planned" only confirms ghosts whose end ≤ now. On past days it confirms all of them.

---

## 1. Screens and navigation

**Shell:**
- **Left nav rail (56px):** Day, Week, Goals, Review, then Settings at the bottom. The Review icon carries a badge with the count of unreviewed past days.
- **Top bar (per screen):** `‹ [Today] ›`, then a date label (`Sun 18 Oct 2026 · W42 ▾` opens a mini-calendar with a review-status dot per day), then view actions, then undo/redo, then a panel toggle.
- **Right panel (280px, collapsible with Ctrl+B, shown in Day and Week):** **Week Budget** (per-goal progress against target) plus **This week's outcomes** (you can tick them here). Clicking a goal there highlights its blocks and dims the others. Below 1200px wide the panel auto-collapses to an overlay.
- **Global overlays:** block editor popover, context menu, command palette (Ctrl+K), shortcuts sheet (?), toasts with Undo.
- **Window decorations:** use native ones. Custom titlebars on KDE Wayland are a known pain point.

**MVP screens:**
1. **Day:** Plan | Actual. This is the core.
2. **Week:** 7 days, in Auto / Plan / Actual / Split modes. Used to plan across days.
3. **Goals:** two tabs, "This week" (targets + outcomes) and "All goals" (manage).
4. **Review:** weekly review.
5. **Settings** (a dialog is enough):
   - week start (Mon/Sun)
   - day view start hour (07:00)
   - snap (5/10/15/30, default 15)
   - default block length (60m)
   - 12/24h (defaults to the locale)
   - theme (System/Light/Dark)
   - "count unreviewed past plan as actual (hatched)" (on)
   - "actual lane prevents overlaps / carve" (on)
   - review nudge time (18:00)
   - export/import JSON, open data folder

**Post-MVP:**
- templates and recurring blocks
- a "running block" (a live actual block whose end follows now, start/stop)
- Overlay week mode
- multi-week trend charts
- OS notifications and a tray icon ("Now: Thesis → Next: Gym")
- quick natural-language add (`thesis 9-11`)
- title autocomplete per goal
- multi-select / marquee
- blocks that cross midnight
- ICS import
- a demo-data profile
- manual "link to plan block"
- ripple-edit mode in Plan

---

## 2. Day view

### Layout
- A time gutter (48px), then the **Plan** column, then a **link gutter** (14px), then the **Actual** column. Plan sits on the left because you read intent first, then reality.
- The two columns have equal width, up to about 420px each.
- **Summary bar** above the columns: `Plan 7h45 · Actual 6h30 · Unplanned 1h00 · Skipped 1h15 · Replaced 0h30`, plus per-goal chips (`● Thesis 3h/2h30`).
- **Vertical scale:** 96px/h by default (15 min = 24px). Ctrl+= / Ctrl+- / Ctrl+wheel cycles 48/64/96/128. The full 0–24h range is scrollable.
- **Initial scroll:** today → now − 1h; other days → the day start setting.

### Now line
- An accent-colored line across both columns, with a time label in the gutter. It updates every minute.
- The Actual column's future area gets a subtle hatched background. It is allowed but de-emphasized: logging the future is odd.

### Visual language (color is never the only cue)

| Element | Style |
|---|---|
| Plan block | Outline (1.5px goal-color border), 12–18% tint fill, goal-dark text. Reads as intent. |
| Actual block | Solid goal-color fill, text color chosen by OKLCH lightness. Reads as fact. A delta badge shows when it is linked and different: `+15m late`, `−30m`, `goal: Admin` if the goal was swapped. |
| Ghost | Dashed border, no fill, 55% opacity, `?` glyph. Shows inline `[✓] [✕]` on hover or selection. Rendered *below* confirmed actual blocks (z-index), full lane width. |
| Plan badge: confirmed | `✓` |
| Plan badge: skipped | `✕`, struck-through title, 50% opacity |
| Plan badge: replaced | `⇄` (linked actual has a different goal) |
| Plan badge: pending past | `•` |
| Untagged block | Neutral gray (`--goal-none`) |
| Past-day plan column | Soft-locked: lock icon in the column header. Pointer edits show a tooltip, "Unlock past plan to edit"; clicking the lock unlocks it for the session. This keeps the plan honest for review. |

### Link gutter
- For every linked pair whose times differ, draw a translucent SVG polygon (a "drift ribbon"). It joins the plan block's y-span on the left edge of the gutter to the actual block's y-span on the right edge, in the goal color at 20% opacity.
- Identical pairs get a 1px tick.
- Hovering or selecting either side highlights the ribbon and its counterpart (outline glow).
- In Week Split mode the gutter is too narrow, so ribbons are skipped and only the counterpart highlight is shown.

### Empty states
- **Empty plan:** a centered hint, "Drag to block time · or press N", with buttons `[Copy yesterday's plan] [Copy last Sunday's plan]`.
- **Empty actual with no plan:** "Log what you actually did: drag to add."

### Block editor popover
The popover is anchored to the block and opens after a create, on double-click, or with Enter.

```
┌ Block ────────────────────────────────────┐
│ Title [Ch.2 literature review          ]  │
│ Goal  [● Thesis                     ▾] 1-9│   ← combobox: type to filter, "＋ Create goal 'x'"
│ Time  [09:00] – [10:30]   1h30            │   ← accepts 915, 9:15, 9.15a, end "+45m"
│ Plan · linked → Actual 09:15–10:45 (+15m) │
│ Notes [                                 ] │
│ [Delete]      [As planned a] [Skip s] [⏎] │   ← As planned / Skip only on plan/ghost
└───────────────────────────────────────────┘
```

- Field changes apply live; the whole popover session is coalesced into one undo entry.
- Esc closes. Esc on a freshly drawn block with no title and no goal cancels the create.
- The displayed title is `title || goal.name || "Untitled"`.

---

## 3. Week view

**Columns:** time gutter plus 7 day groups of equal width.

**Day header:**
- `Mon 12`
- a review dot: ● reviewed / ◐ partially / ○ unreviewed, with a future day shown blank
- `P 8h · A 7h`
- clicking the header opens that day.

**Modes** (segmented control; `v` cycles them):
- **Auto (default):** past days and today are split into P|A sub-columns; future days show the plan at full width. Planning the future gets space, and reviewing the past gets comparison.
- **Plan:** plan lanes only, full width. Use this for weekly planning.
- **Actual:** actual lanes only.
- **Split:** every day is P|A.

**Narrow-block rules:**
- Block text is hidden when width < 56px or height < 18px. The goal color stripe always shows, and the full label goes in a tooltip and the aria-label.
- The default scale in Week is 56px/h.

**Drag targets are (day, lane):**
- Same lane, other day → **move**.
- Ctrl held at drop → **copy**.
- Plan → Actual, any day → **"log as actual"**: creates a linked copy, and the plan stays. Linking across days is allowed but rare.
- Actual → Plan → **copy as plan**, with no link.
- A small badge next to the cursor states the drop semantics: `Move`, `Copy`, `Log as actual`.

The right panel (Week Budget) behaves as in Day view. Its "unallocated" figure updates live while you drag.

---

## 4. Goals editor

### Tab "This week" (week nav ‹ W43 ›)
- One row per active goal, in sort order. That order is also the 1–9 hotkey order.
- Row contents:
  - color swatch, name
  - kind toggle `≥ / ≤ / –`
  - target hours (0.25h steps, typed or scrubbed)
  - a muted "(default 15h)" label and a reset-to-default link
  - outcome checklist: inline add (Enter adds the next item), checkbox, drag to reorder, delete on hover, and `n/m` completion.
- **Effective target** = the week override if present, else the goal's default. A new week therefore inherits targets with zero work.
- Header actions:
  - `[Copy targets from last week]`
  - `[Carry over N unfinished outcomes from W42]`
  - a sanity line: `Targets: 28h min across 4 goals · 3h max limits`
- Goals with kind `none` are listed under "Tracked (no target)" and have outcomes only.

### Tab "All goals"
- Fields: name, color (a palette of 12 swatches), default kind and target, archive. Archived goals stay in history and drop out of pickers.
- Drag to reorder.
- New goals take the next unused palette color.

---

## 5. Weekly Review

### Header
- Week nav.
- Coverage: `6/7 days reviewed — Wed unreviewed [Review Wed →]`.
- KPIs: `Planned 41h · Actual 37h30 · As-planned 72% · Unplanned 6h · Skipped 9h`.

### Goal table
Columns: goal, target, plan, actual, Δ vs target, bullet chart, outcomes n/m, status chip.

All rows share one hours scale, so bar lengths are comparable: `scaleMax = max over goals of (target, plan, actual) × 1.1`.

Bullet chart encoding:

| Mark | Meaning |
|---|---|
| Light track | 0 → target |
| Vertical tick | Target / limit |
| Hollow outlined bar | Planned |
| Solid bar | Actual (confirmed) |
| Hatched extension | Unreviewed-assumed actual |
| Bar turns warning color with a `▲` | A `max` goal is over its limit |

Status chips:
- `min` goals: `On track` (actual ≥ target), `Under −3h30`.
- `max` goals: `Within limit`, `Over +1h20`.

### Other sections
- **Biggest gaps:** top 3 cards, ranked by severity: a min goal under target (by hours), a max goal over its limit, or a goal with ≥ 2 skipped sessions. Each card links to the blocks involved.
- **Unplanned (actual with no link):** totals by goal, plus the top blocks (`Sat 14:00–15:20 Social media`).
- **Skipped (plan blocks skipped, or pending on past days):** totals by goal, plus a block list. Each row offers `Copy to next week` (post-MVP: reschedule).
- **Replaced:** linked pairs with a goal swap (`Thesis → Admin 1h30`).
- **Drift:** average start delay of linked pairs, and total over/under-runs.
- **Day by day:** small multiples, one 7-bar strip per goal (plan outline vs actual fill per day).
- **Outcomes:** the full checklist per goal, which you can tick here.
- **Reflection:** one notes textarea per week (cheap, high value, in MVP).
- **Footer:** `[Carry N unfinished outcomes → W43]` `[Set W43 targets →]`.

### Metric definitions
These are link-based, so a block that was only *shifted in time* is not counted as skipped plus unplanned. All are per goal, per week.

- `planned = Σ dur(plan blocks)`
- `actual = Σ dur(confirmed actual) + (setting ? Σ dur(ghosts with end ≤ now, minus overlap with confirmed actual) : 0)`. The second term is shown hatched.
- `unplanned = Σ dur(actual where plan_block_id IS NULL)`
- `skipped = Σ dur(plan where review_state='skipped')`. Pending plan blocks on past days are reported separately as "unreviewed".
- `replaced = Σ dur(actual linked where actual.goal ≠ plan.goal)`. It is attributed to the actual goal and listed under the plan goal.
- `as-planned % = Σ dur(linked actual with same goal) / planned`
- `drift`: `startDelta = firstPiece.start − plan.start`, `durDelta = Σpieces − plan.dur`

Put all of this in one pure `computeStats(blocks, goals, weekTargets, now, settings)` function. The Day summary bar, the Week Budget panel and the Review screen all use it.

---

## 6. Timeline interactions

### Pointer
- Hold `pointerdown` until a **4px** movement threshold, so a click and a drag are told apart.
- **Snap:** 15m by default. Holding Shift while dragging uses a 5m fine snap.
- **Magnet:** within 8px, edges snap to (a) neighbor edges in the same lane, (b) the edges of the linked or counterpart block in the other lane, and (c) the now line. This is the single biggest speed-up when correcting.

| Gesture | Result |
|---|---|
| Drag on empty space | Create. The anchor is snapped down, the extent is snapped, and the minimum is one snap step. On release the popover opens with the title focused. |
| Single click on empty space | Clears the selection and puts the keyboard slot cursor there. |
| Double-click on empty space | Creates a block of the default length at the slot. |
| Click a block | Select it. Shift+click on a block is post-MVP. |
| Double-click a block | Opens the popover. |
| Drag block body | Move. The grab offset is preserved; the block is clamped to [0, 1440 − dur]. Cross-lane and cross-day semantics follow §3. |
| Drag top/bottom edge | Resize. Hit zone is 6px, extending 3px outside the block. Blocks shorter than 30m show their handles only on hover. Cursor is `ns-resize`. |
| Drag on a ghost | Materializes a linked actual at the new position. |
| Esc during any drag | Cancels and reverts. |
| `pointercancel` | Cancels. |
| Ctrl at drop | Copy instead of move. Ctrl rather than Alt, because Alt+drag is a window-manager move on KDE Plasma 5. |

### Committing in the Actual lane (carve)
- Overlapped confirmed actual blocks are trimmed, split (pieces under 5m are dropped, and both pieces keep `plan_block_id` and notes), or removed.
- During the drag, the parts that will be cut are previewed with a dim overlay.
- One undo entry covers the whole commit, and a toast reports it: "Split 'Thesis' around 'Email' · Undo".
- Carve can be turned off in Settings.

### Context menu
The webview's own context menu must be suppressed everywhere except text inputs.

**On a plan block:**
- Edit… ⏎
- Set goal ▸ (1–9)
- Happened as planned `a`
- Skip `s`
- Copy to Actual
- Duplicate Ctrl+D
- Copy to tomorrow
- Copy / Cut / Paste
- Delete ⌫

**On a ghost:**
- Happened as planned `a`
- Happened at a different time… (enters move mode)
- Skip `s`
- Edit…

**On an actual block:**
- Edit
- Set goal ▸
- Split at HH:MM (the right-click position, snapped) `x`
- Duplicate
- Copy to Plan
- Delete

**On empty space:**
- New block here `n`
- Paste
- Confirm rest of day as planned ⇧A
- Copy plan from ▸ (yesterday / same weekday last week)

### Day-level actions
- **Confirm rest as planned** (top bar, ⇧A): materializes every pending ghost with end ≤ now (all of them on past days) and carves them around the existing confirmed actual blocks. A ghost that ends up fully covered is set to skipped.
- **Copy plan to actual (whole day):** the same action, labeled for clarity in the command palette.

### Keyboard shortcuts
Use `e.key` for letters. For `[ ] { }`, fall back to `e.code`, so non-US layouts work.

**Global:**

| Keys | Action |
|---|---|
| `Ctrl+K` / `?` | Command palette / shortcuts sheet |
| `d` `w` `g` `r` | Day / Week / Goals / Review |
| `t` | Today (or this week) |
| `[` / `]` | Previous / next day. In Week, Goals and Review: week. |
| `{` / `}` | Previous / next week (Day view) |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo. In-memory, 100 steps; one gesture is one entry. |
| `Ctrl+B` | Toggle right panel |
| `Ctrl+= / - / 0` | Timeline zoom |
| `Ctrl+,` | Settings |
| `v` | Cycle week mode |
| `Esc` | Cancel drag, then close popover, then clear selection |

**Timeline focused, no block selected (slot cursor):**

| Keys | Action |
|---|---|
| `↑/↓` | Move the slot cursor by one snap step |
| `Shift+↑/↓` | Extend the range |
| `←/→` | Switch lane (Day) or lane/day (Week) |
| `Enter` | Create a block over the range |
| `n` | New block at the cursor. With no cursor: next snap boundary after now, Plan lane, default length. |
| `Ctrl+V` | Paste at the cursor |

**Block selected:**

| Keys | Action |
|---|---|
| `Enter` / `F2` | Edit |
| `↑/↓` | Move by one snap step |
| `Shift+↑/↓` | Change the end |
| `Alt+↑/↓` | Change the start |
| `←/→` | Select the nearest block in the adjacent column |
| `Ctrl+←/→` | (Week) move the block to the previous/next day |
| `Tab` / `Shift+Tab`, or `j/k` | Next / previous block in chronological order (roving focus) |
| `1–9` / `0` | Set goal by sort order / clear goal |
| `a` / `s` | As planned / skip (plan block or ghost) |
| `⇧A` | Confirm rest of the day |
| `x` | Split at the midpoint, snapped |
| `Ctrl+D` / `C` / `X` / `V` | Duplicate (placed right after) / copy / cut / paste |
| `Delete` / `Backspace` | Delete. On a ghost: skip. |

**Rules:**
- The handler is ignored when focus is in an input, textarea or `[contenteditable]`, or when `e.isComposing` is true.
- Shortcuts are scoped: a popover or dialog swallows timeline keys.
- Avoid browser-ish keys. WebView2 has browser accelerators (F5, Ctrl+R, Ctrl+F, Ctrl+P); swallow them in the global handler, and check in release builds on Windows that this actually blocks them.

---

## 7. Timeline implementation

### Recommendation: (a) a custom component with Pointer Events and absolute positioning. No calendar library and no dnd-kit.

| Option | Verdict |
|---|---|
| **(a) Custom** | ✅ Full control over ghosts, carve, link ribbons, per-day split, magnets and keyboard semantics. Zero runtime dependencies. Estimated at roughly 1.5k lines. |
| (b) react-big-calendar + resources + `withDragAndDrop` | ❌ MIT, but you would be fighting its event model for the ghost layer, carve preview, link gutter and Auto split. Weak keyboard a11y for events. Needs a localizer (moment, date-fns…). The DnD addon leaves move/resize logic to you anyway. |
| (c) FullCalendar | ❌ Core is MIT, but resource time-grid is Premium: tri-licensed Commercial / CC BY-NC-ND / **AGPLv3 (as of v7)**. Using it forces the open-source app to AGPL. Two side-by-side MIT timeGrids would make cross-column drag clunky. Heavy DOM and CSS. |
| (d) dnd-kit | ❌ for this use. `@dnd-kit/react` is still 0.x (0.5.1 as of Oct 2026, API churn). It is built for sortable lists and drop zones, not time-grid create/resize. Its keyboard sensor moves by pixels or zones, not by time. Could be used later for reordering goals/outcomes lists, though plain pointer code is fine there too. |

A Tauri-specific reason to use Pointer Events: avoid **HTML5 drag-and-drop**. On Windows, Tauri's default `dragDropEnabled` handler intercepts OS drag events, so the webview never gets `dragover`/`drop`. With pointer events we can keep `dragDropEnabled` on and use `onDragDropEvent` for "drop a JSON backup onto the window to import".

### Component tree
```
<AppShell> NavRail | TopBar | <Outlet/> | RightPanel(WeekBudget, Outcomes)
  <DayView date> / <WeekView weekStart mode>
    <TimelineScroller>            ← scroll container; owns zoom, auto-scroll, ONE delegated pointer handler set
      <TimeGutter/>  <NowLine/>   ← NowLine spans all columns
      <DayGroup day>* (1 in Day, 7 in Week)
        <LaneColumn day lane="plan" data-day data-lane>
          <SlotGrid/>             ← hour/quarter lines (CSS background-image repeating-linear-gradient)
          <BlockLayer>  <BlockView/>*            ← absolutely positioned, memoized by block id+geometry
        <LinkGutter pairs/>       ← SVG ribbons (Day view / wide Split only)
        <LaneColumn day lane="actual">
          <GhostLayer> <GhostBlock/>*            ← z-index below BlockLayer, laid out like plan
          <BlockLayer> <BlockView/>*
          <FutureHatch/>
      <DraftLayer/>               ← renders the in-flight drag preview + carve preview only
      <SlotCursor/>
  <BlockEditorPopover/> <ContextMenu/> <CommandPalette/> <ShortcutsDialog/> <Toaster/>
hooks: useTimelineGeometry, useDragMachine, useShortcuts(scope), useNow(60s), useAutoScroll
pure:  layoutLane(), carve(), confirmGhost(), computeStats(), snap(), magnet()
```

### Geometry
- `y = (min − 0) × pxPerMin`
- `pointerMin = (clientY − laneRect.top) / pxPerMin`. The lane rect is re-read on scroll during a drag (cheap). Column rects are cached at drag start for hit-testing `(day, lane)` from `clientX`. Don't use `elementFromPoint`.
- Times are stored as local `date` + `start_min`/`end_min` (0..1440). Wall-clock minutes, so a DST day simply has a 23h or 25h reality without special handling.

### Drag state machine
```
idle
 ├─ down(empty)        → pendingCreate{anchorMin, lane, day}
 ├─ down(block body)   → pendingMove{blockId, grabOffsetMin}
 ├─ down(edge top|bot) → resizing{blockId, edge}            (no threshold)
 └─ down(ghost)        → pendingMove{ghostOf: planId}
pending* ──move>4px──→ creating | moving
pending* ──up──────→ click → select / set slot cursor (dblclick → create default / edit)
creating|moving|resizing
 ├─ move / scroll / rAF autoscroll → recompute draft {day, lane, start, end, mode: move|copy|log|carvePreview}
 ├─ key Ctrl/Shift change           → recompute (copy / fine snap)
 ├─ Esc | pointercancel             → cancel → idle (no store write)
 └─ up                              → commit(Command) → store (optimistic) → persist → idle
                                      creating → open popover on new block
```
- Machine state lives in a `useRef`. The *draft* lives in a tiny Zustand slice that only `<DraftLayer>` subscribes to, so the timeline doesn't re-render at 60fps.
- The draft uses `transform: translateY` / `height`.
- Use `setPointerCapture` on `pointerdown`. Set `touch-action: none` and `user-select: none` on lanes.

### Overlap layout
`layoutLane(blocks)` runs per lane per day and is memoized. It is the Google-Calendar style, O(n log n):
1. Sort by start ascending, then end descending.
2. Sweep into clusters; a cluster ends when `b.start ≥ clusterMaxEnd`.
3. Within a cluster, put each block in the first column whose `lastEnd ≤ b.start`, or open a new column.
4. `cols` = the number of columns in the cluster.
5. Expand: `span` = consecutive free columns to the right over b's interval.
6. `left = col/cols`, `width = span/cols` (with a 2px gap).

The Plan lane uses it as is. Ghosts use the plan layout, so they mirror the plan column. The Actual lane is non-overlapping by the carve invariant but still runs layout as a safety net (for example after an import, or with carve turned off).

### Auto-scroll
- While dragging, if the pointer is within 48px of the scroller's top or bottom edge, a rAF loop scrolls by `speed = 18px × (1 − dist/48)²` per frame and then recomputes the draft from the last pointer position.
- Wheel scrolling during a drag also triggers a recompute.
- With `prefers-reduced-motion`, scrolling is instant rather than smooth.

### Persistence and undo
- Every mutation is a `Command {do, undo, label}` that operates on the store. The store writes through to the Tauri/SQLite layer.
- Batches (carve, confirm-all, paste) are a single command.
- Undo is in-memory only.

### Performance
About 30 blocks per day and about 200 per week is trivial. `BlockView` is memoized on `(id, top, height, left, width, title, goal, state)`.

### Tauri and webview gotchas
- Suppress the native `contextmenu` event except in editable fields.
- Do not use HTML5 DnD (see above).
- Use native decorations.
- Ctrl+wheel: `preventDefault` it over the timeline for our own zoom. Webview zoom hotkeys are off by default.

---

## 8. Styling and theming

**Recommendation: Tailwind CSS v4 + shadcn/ui.**

- Since July 2026, `shadcn init` defaults to **Base UI** primitives. Radix is still supported with `-b radix`.
- Primitives used: Popover, Dialog, Context Menu, Dropdown Menu, Combobox (goal picker), Tooltip, Tabs, Checkbox, Toggle Group, Command (cmdk), and Sonner toasts.
- Rationale:
  - shadcn copies components into the repo, so there is no runtime UI-library lock-in and contributors already know the pattern.
  - The headless primitives handle the focus-trap, ARIA and keyboard work for popovers and menus, which we should not hand-roll.
  - Tailwind v4 is build-time only.
- The timeline itself uses plain Tailwind classes plus inline `style={{top,height,left,width}}` and CSS variables. No component library is used inside the timeline.

### Theme
- Settings offers System / Light / Dark; the choice is applied as `<html data-theme>`.
- Tailwind: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- **Do not rely on CSS `prefers-color-scheme` alone.** On your machine (KDE Plasma on Wayland), WebKitGTK reports light even when the desktop is dark, because it only reads GTK's prefer-dark setting.
- For "System", use Tauri's `getCurrentWindow().theme()` and `onThemeChanged`. They read the freedesktop `color-scheme` over D-Bus as of **Tauri 2.11** (the `dbus` feature is on by default), so pin `tauri >= 2.11`. Fall back to `matchMedia` if the theme comes back null.
- Do not call `setTheme()` on Linux to switch back to System: there are known tao bugs where `set_theme(None)` is treated as light and system changes override explicit themes. For Light/Dark, only toggle the CSS attribute.

### Goal palette
12 presets with matched OKLCH lightness, taken from the Tailwind v4 palette variables:

`blue-500, emerald-500, amber-500, rose-500, violet-500, cyan-500, orange-500, pink-500, lime-600, indigo-500, teal-600, stone-500`, plus `--goal-none: slate-400`.

Derived tokens per goal, set as a CSS variable on the block:
```css
--g: var(--color-blue-500);
--plan-bg:   color-mix(in oklch, var(--g) 14%, var(--surface));   /* dark: 22% */
--plan-bd:   var(--g);
--plan-fg:   color-mix(in oklch, var(--g) 70%, var(--text));
--actual-bg: color-mix(in oklch, var(--g) 88%, var(--surface));
--actual-fg: /* black or white, chosen by oklch L of --g (threshold ≈ 0.68) */;
```

Plan vs actual is encoded by **shape** (outline vs fill) and ghosts by dashes, so goal identity can use color freely. Status always uses an icon plus text.

---

## 9. Charts

**Hand-rolled SVG.** Recharts 3 is about 130–170 KB gzipped, which is overkill for bars. visx is lighter but adds d3 concepts for little gain here.

- `<BulletBar target kind planned actual unreviewed scaleMax/>`: a `viewBox` of width 100 × height 20. Track, target tick, plan outline rect, actual rect, and an SVG `<pattern>` for the hatched part. About 60 lines.
- `<DayBars days[7]/>`: small multiples, 7 pairs of plan-outline and actual-fill bars. About 40 lines.
- `<WeekComposition/>` (optional): one stacked horizontal bar of actual hours by goal.
- Every chart gets `role="img"` and an `aria-label` with a numeric summary. The goal table always shows the numbers in text, so the chart is never the only carrier of data.
- Post-MVP multi-week trends: still hand-rolled polylines. Reach for visx only if interactions get rich.

---

## 10. Empty states, onboarding and nudges

### First-run dialog (3 steps, skippable)
1. **"Plan on the left, reality on the right."** A 3-frame illustration: plan → ghost → corrected.
2. **Your goals.** Toggleable suggested chips with editable targets: `Deep work ≥10h`, `Exercise ≥4h`, `Learning ≥3h`, `Admin (tracked)`, `Social media ≤3h`. Or `[Start empty]`. This creates **goals only, no sample blocks**, so real data isn't polluted. A demo-data profile is post-MVP.
3. **Preferences:** week start, day start, 12/24h.

It ends on today's Day view with a coach-mark in the Plan column: "Drag to create your first block."

### Nudges
In-app only for MVP: a dismissible banner below the top bar (dismissal lasts per day) plus nav badges.

| Trigger | Nudge |
|---|---|
| Today, now ≥ review time (18:00), and there are ended pending ghosts | "Review today: 3 blocks unconfirmed" `[Review]` scrolls to the first one, `[Confirm rest]` |
| now ≥ 18:00 and tomorrow's plan is empty | "Plan tomorrow" `[Open tomorrow]`, which offers Copy-from buttons |
| Past days in this or last week have pending ghosts | Review badge count, and a per-day jump list on the Review screen |
| First launch in a new week | "Kick off W43: set targets & outcomes" plus "Review W42" |

### Empty states
- **Goals:** "Goals show where your time went. Add your first."
- **Review with no targets:** still show actual by goal, plus "Set targets to compare."
- **Review with no data:** "Nothing logged this week yet."

---

## 11. Accessibility and keyboard-first design

- **Structure:**
  - Each lane is `role="group"` with `aria-label="Plan, Monday 12 October"`.
  - Blocks are `<button>`s with roving `tabindex` within a lane, and an `aria-label` like "Thesis: Ch.2 literature review, plan, 9:00 to 10:30, 1 hour 30 minutes, confirmed, actual started 15 minutes late".
  - Ghosts are labeled "unconfirmed copy of plan …".
- **Live region:** a visually hidden `aria-live="polite"` region announces the result of every keyboard or drag commit: "Moved to 9:15 to 10:45", "Split Thesis around Email", "Confirmed 4 blocks as planned".
- **Keyboard parity:** every pointer action has a keyboard path (§6): create via the slot cursor, move/resize via arrows, cross-lane via `a` or "Copy to Actual", cross-day via Ctrl+←/→, and context menus via Shift+F10 or the Menu key.
- **Focus:**
  - After create, focus goes to the title input.
  - When the popover closes, focus returns to the block.
  - After a delete, focus goes to the next block, or the slot cursor if there is none.
  - Focus rings: 2px, offset, never removed.
- **Visuals:**
  - Shape-coded lanes (outline / fill / dashed).
  - Icons plus text for status.
  - Text contrast ≥ 4.5:1 via the black/white rule.
  - The minimum rendered block height is 16px; the full label is in a tooltip and the aria-label.
- **Motion:** `prefers-reduced-motion` disables transitions and smooth scroll.
- **Scaling:** timeline zoom is independent of webview font scaling. The layout is built in `rem` so it survives a larger system font.

---

## 12. Wireframes

### Day view (today, Sun 18 Oct, 11:42)
```
┌────┬─────────────────────────────────────────────────────────────────────┬────────────────────────┐
│ ◷  │ ‹ [Today] ›  Sun 18 Oct 2026 · W42 ▾     [Confirm rest ⇧A] [Copy…▾] ↶ ↷ │                    ▣ │
│Day │ Plan 7h45 · Actual 4h30 · Unplanned 1h · Skipped 1h · ●Thesis 3h/2h45 ●Gym 1h/–│ WEEK BUDGET  W42  │
│ ▦  │      PLAN  🔓                       ┊┊  ACTUAL                        │ ●Thesis ≥15h           │
│Week│ 08 ┌──────────────────────────┐ ✓  ┊┊ ┌──────────────────────────┐   │ ███████▒▒▒░░┆  9/15h  │
│ ◎  │    │ Thesis · ch.2 lit review │    ╲┊ │ Thesis · ch.2 lit  +15m  │   │ +3h planned · 3h free  │
│Goal│ 09 │                          │     ╲ │                          │   │ ●Exercise ≥5h          │
│ ▤² │    └──────────────────────────┘     ╱ └──────────────────────────┘   │ ██████░░░░┆ 3/5h       │
│Rev │ 10 ┌──────────────────────────┐ ✕  ┊┊ ┌──────────────────────────┐   │ ●Social ≤3h            │
│    │    │ ~~Email / admin~~        │    ┊┊ │ Social media  (unplanned)│   │ ███████████▲ 3.4/3h ⚠  │
│    │ 11 └──────────────────────────┘    ┊┊ └──────────────────────────┘   │ ─────────────────────  │
│    │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 11:42 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ OUTCOMES W42           │
│    │ 12 ┌──────────────────────────┐    ┊┊ ┊┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┊//│ ●Thesis 1/2            │
│    │    │ Gym                      │ •  ┊┊ ┊ ? Gym          [✓] [✕]   ┊//│  ☑ Finish lit review   │
│ ⚙  │ 13 └──────────────────────────┘    ┊┊ ┊┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┊//│  ☐ Draft ch.2 §1       │
└────┴─────────────────────────────────────────────────────────────────────┴────────────────────────┘
 legend: ┌─┐ plan outline · solid actual · ┊┄┊ ghost · ╲╱ drift ribbon · // future hatch · ✓✕• plan state
```

### Week view (Auto mode; the illustration assumes today = Wed 21 Oct)
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ [This week] ›  19–25 Oct 2026 · W43        Mode [Auto|Plan|Actual|Split] v      ↶ ↷  ▣     │
├────┬────────────┬────────────┬────────────┬──────────┬──────────┬──────────┬─────────────────┤
│    │ Mon 19 ●   │ Tue 20 ◐   │ Wed 21 today│ Thu 22   │ Fri 23   │ Sat 24   │ Sun 25          │
│    │ P8h A7h30  │ P7h A5h    │ P6h A2h    │ P6h      │ P5h      │ P2h      │ –               │
│    │  P  │  A   │  P  │  A   │  P  │  A   │   PLAN   │   PLAN   │   PLAN   │   PLAN          │
│ 08 │┌───┐│┌───┐ │┌───┐│┌───┐ │┌───┐│┌───┐ │┌────────┐│┌────────┐│          │                 │
│    ││Ths│││Ths│ ││Ths│││Ths│ ││Ths│││Ths│ ││Thesis  │││Thesis  ││          │                 │
│ 10 │└───┘│└───┘ │└───┘││Soc│ │└───┘│└───┘ │└────────┘│└────────┘│┌────────┐│                 │
│    │┌───┐│┌───┐ │┌───┐│└───┘ │━━━━━│━━━━━ │┌────────┐│          ││Hike    ││                 │
│ 12 ││Gym│││Gym│ ││Adm││      │┌───┐│┊Gym┊ ││Gym     ││          ││        ││                 │
│    │└───┘│└───┘ │└───┘│      │└───┘│┊┄┄┄┊ │└────────┘│          │└────────┘│                 │
└────┴─────┴──────┴─────┴──────┴─────┴──────┴──────────┴──────────┴──────────┴─────────────────┘
 drag Thu Thesis → Fri = move · Ctrl = copy · drag Mon P → Mon A = "Log as actual"
```

### Goals editor ("This week" tab)
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Goals   [ This week | All goals ]      ‹ W43 · 19–25 Oct ›                                   │
│ Targets: 28h min across 4 goals · 3h max      [Copy targets from W42] [Carry over 2 from W42]│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 ● Thesis        [≥|≤|–] [ 15.0 ]h  (default 15h)                         Outcomes 1/3      │
│     ☑ Finish lit review     ☐ Draft ch.2 §1     ☐ Send outline to advisor     [+ add]       │
│ 2 ● Exercise      [≥|≤|–] [  5.0 ]h  (default 4h ↺)                        Outcomes 0/1      │
│     ☐ Run 3×                                                              [+ add]           │
│ 3 ● Learning      [≥|≤|–] [  3.0 ]h                                        Outcomes 0/0      │
│ 4 ● Social media  [≥|≤|–] [  3.0 ]h  max limit                                               │
│ ─ Tracked (no target) ─────────────────────────────────────────────────────────────────────  │
│ 5 ● Admin   6 ● Commute                                                    [+ New goal]      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Weekly Review
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Weekly review   ‹ W42 · 12–18 Oct ›     6/7 days reviewed — Wed unreviewed [Review Wed →]    │
│ Planned 41h · Actual 37h30 · As-planned 72% · Unplanned 6h · Skipped 9h · Avg start +12m     │
├──────────────┬───────┬──────┬───────┬────────┬────────────────────────────────┬──────┬───────┤
│ GOAL         │TARGET │ PLAN │ACTUAL │ Δ      │ 0     5     10    15    20h    │ OUTC │STATUS │
│ ● Thesis     │ ≥15h  │ 14h  │ 11h30 │ −3h30  │ ██████████▒▒▯▯▯▯▯┆             │ 2/4  │Under  │
│ ● Exercise   │ ≥5h   │ 5h   │ 5h15  │ +0h15  │ ███████▯┆                      │ 1/1  │On trk │
│ ● Learning   │ ≥3h   │ 4h   │ 1h    │ −2h    │ ██▯▯▯▯┆                        │ 0/1  │Under  │
│ ● Social     │ ≤3h   │ 1h   │ 4h20  │ +1h20▲ │ ▯▯█████┆███▲                  │  –   │Over   │
│ ● Admin      │  –    │ 3h   │ 4h    │        │ ▯▯▯█████                       │  –   │       │
│  █ actual  ▒ unreviewed (assumed)  ▯ planned  ┆ target/limit                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ BIGGEST GAPS  [Thesis −3h30 under target] [Social +1h20 over limit] [Learning: 2 sessions skipped]│
├───────────────────────────────┬───────────────────────────────┬──────────────────────────────┤
│ UNPLANNED 6h                  │ SKIPPED 9h                    │ REPLACED 1h30                │
│ Social 3h20 · Sat 14:00–15:20 │ Thesis 4h · Tue 14–16, Thu 9–11│ Thesis→Admin 1h30 · Fri 10–… │
│ Admin 1h · Mon 16:00–17:00    │ Learning 3h · Wed 19–20 …     │                              │
├───────────────────────────────┴───────────────────────────────┴──────────────────────────────┤
│ DAY BY DAY      Mon Tue Wed Thu Fri Sat Sun                                                  │
│ ● Thesis        ▯█  ▯█  ▯▒  ▯█  ▯▯  ··  ▯█                                                   │
│ ● Social        ·█  ··  ·▒  ▯█  ·█  ·█  ·█                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ OUTCOMES  ☑ Finish lit review ☐ Draft ch.2 §1 …  │ REFLECTION [ What went well / change…   ] │
│                         [Carry 2 unfinished outcomes → W43]   [Set W43 targets →]           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Data requirements implied by the UX (for the data-model design)

- `goals(id, name, color, default_kind: min|max|none, default_target_min, sort, archived_at)`
- `week_goals(week_start, goal_id, kind, target_min)`. These are overrides only; the effective target falls back to the goal default.
- `outcomes(id, week_start, goal_id, text, done, sort)`
- `week_notes(week_start, text)`
- `blocks(id, date, lane: plan|actual, start_min, end_min, title, goal_id NULL, notes, plan_block_id NULL /*actual only*/, review_state pending|skipped /*plan only*/, created_at, updated_at)`
- `settings(key, value)`, including dismissed-nudge dates and the onboarding-done flag.
- `week_start` is derived from the week-start setting. Store dates as `YYYY-MM-DD` local.
- Required indexes: `(date, lane)` and `(plan_block_id)`.

---

## 14. Suggested build order

1. Shell, theme and Day view with Plan lane only: geometry, the drag machine, layout, popover, undo.
2. Actual lane: ghosts, materialize, carve, link gutter, as-planned/skip/confirm-rest.
3. Goals (both tabs) and the Week Budget panel; `computeStats`.
4. Review screen and charts.
5. Week view: Auto/Split modes and cross-day/cross-lane drops.
6. Keyboard completeness, command palette, onboarding and nudges, export/import, a11y pass.

---

## Sources
- [FullCalendar license](https://fullcalendar.io/license)
- [FullCalendar Premium docs](https://fullcalendar.io/docs/premium)
- [fullcalendar-workspace v7 (AGPLv3)](https://newreleases.io/project/github/fullcalendar/fullcalendar-workspace/release/v7.0.0-rc.0)
- [Bryntum: FullCalendar vs Big Calendar](https://bryntum.com/blog/react-fullcalendar-vs-big-calendar/)
- [shadcn/ui July 2026: Base UI as default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- [@dnd-kit/react on npm](https://www.npmjs.com/package/@dnd-kit/react)
- [Tauri dragDropEnabled interception (WebView2)](https://github.com/stemdeckapp/stemdeck/issues/57)
- [Tauri issue #9427: Linux theme detection](https://github.com/tauri-apps/tauri/issues/9427)
- [Tauri issue #9255: theme not propagated to webview](https://github.com/tauri-apps/tauri/issues/9255)
- [tao issue #1382: Linux set_theme override](https://github.com/tauri-apps/tao/issues/1382)
- [Tauri core releases (2.11 dbus feature)](https://tauri.app/release/core/)
- [Recharts vs visx bundle sizes](https://www.pkgpulse.com/compare/visx__visx-vs-recharts)
- [dark-light crate (XDG portal)](https://github.com/rust-dark-light/dark-light)

### Critical Files for Implementation
These files do not exist yet (the project is greenfield); this is the planned structure:
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/features/timeline/useDragMachine.ts (drag state machine, snap/magnet, auto-scroll)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/features/timeline/lanes.ts (pure `layoutLane`, `carve`, `confirmGhost`, ghost derivation)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/features/timeline/Timeline.tsx (TimelineScroller, LaneColumn, BlockView, GhostLayer, LinkGutter, DraftLayer)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/features/stats/computeStats.ts (planned/actual/unplanned/skipped/replaced/drift; shared by Day summary, Week Budget, Review)
- /home/shrey/Documents/Codes/calendar_goals_webapp/src/styles/theme.css (Tailwind v4 dark variant, goal palette tokens, plan/actual/ghost styles) and /home/shrey/Documents/Codes/calendar_goals_webapp/src/lib/commands.ts (undo/redo command stack)