/** The live drag draft. Only `DraftLayer` subscribes, so the timeline doesn't re-render at 60 fps. */
import { create } from "zustand";
import type { Draft } from "@/features/timeline/dragMachine";

export const useDraft = create<{ draft: Draft | null }>(() => ({ draft: null }));

export const setDraft = (draft: Draft | null) => {
  if (useDraft.getState().draft !== draft) useDraft.setState({ draft });
};
