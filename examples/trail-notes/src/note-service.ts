import { validateNote, type NoteDraft } from "./note.js";
import type { NoteRepository, SavedNote } from "./note-repository.js";

export function saveNote(
  repository: NoteRepository,
  authorId: string,
  requestKey: string,
  draft: NoteDraft,
): SavedNote {
  validateNote(draft);
  return repository.insertOrGet(authorId, requestKey, draft);
}
