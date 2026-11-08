import type { NoteDraft } from "./note.js";
import type { NoteRepository } from "./note-repository.js";
import { saveNote } from "./note-service.js";

export type SubmitNoteRequest = Readonly<{
  authorId: string;
  requestKey: string;
  draft: NoteDraft;
}>;

export type SubmitNoteResponse = Readonly<{ noteId: string }>;

export function submitNote(
  repository: NoteRepository,
  request: SubmitNoteRequest,
): SubmitNoteResponse {
  if (!request.authorId.trim() || !request.requestKey.trim()) {
    throw new Error("An author and request key are required.");
  }

  const note = saveNote(repository, request.authorId, request.requestKey, request.draft);
  return { noteId: note.id };
}
