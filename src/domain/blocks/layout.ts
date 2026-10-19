/**
 * Side-by-side lane layout for overlapping blocks within one day column.
 */

export interface LaneSlot {
  lane: number;
  lanes: number;
}

/**
 * Assigns each item a lane. Items are sorted by start (longest first on ties), grouped into
 * clusters of transitively overlapping items (touching does not overlap), and placed
 * first-fit; `lanes` is the lane count of the item's cluster.
 */
export function layoutLanes<T extends { id: string; startMinute: number; endMinute: number }>(
  items: readonly T[],
): Map<string, LaneSlot> {
  const sorted = [...items].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      b.endMinute - b.startMinute - (a.endMinute - a.startMinute) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const out = new Map<string, LaneSlot>();
  let cluster: LaneSlot[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const close = () => {
    for (const slot of cluster) slot.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.startMinute >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinute);
    } else {
      laneEnds[lane] = item.endMinute;
    }
    const slot: LaneSlot = { lane, lanes: 0 };
    cluster.push(slot);
    out.set(item.id, slot);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  close();
  return out;
}
