export type NoteDraft = Readonly<{ trailId: string; body: string }>;

export function validateNote(draft: NoteDraft): void {
  if (!draft.trailId.trim() || !draft.body.trim()) {
    throw new Error("A trail ID and note body are required.");
  }
}
