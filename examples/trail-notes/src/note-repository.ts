import type { NoteDraft } from "./note.js";

export type SavedNote = NoteDraft & Readonly<{ id: string; authorId: string }>;

export interface NoteRepository {
  insertOrGet(authorId: string, requestKey: string, draft: NoteDraft): SavedNote;
}

export class RequestKeyConflict extends Error {
  constructor() {
    super("This request key was already used for a different note.");
  }
}

export class InMemoryNoteRepository implements NoteRepository {
  readonly #notes = new Map<string, SavedNote>();

  get size(): number {
    return this.#notes.size;
  }

  insertOrGet(authorId: string, requestKey: string, draft: NoteDraft): SavedNote {
    // The lookup and insert are synchronous within this single-process adapter.
    const key = JSON.stringify([authorId, requestKey]);
    const existing = this.#notes.get(key);
    if (existing) {
      if (existing.trailId !== draft.trailId || existing.body !== draft.body) {
        throw new RequestKeyConflict();
      }
      return existing;
    }

    const note = Object.freeze({
      id: `note-${this.#notes.size + 1}`,
      authorId,
      trailId: draft.trailId,
      body: draft.body,
    });
    this.#notes.set(key, note);
    return note;
  }
}
