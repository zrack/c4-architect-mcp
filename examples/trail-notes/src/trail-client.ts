import type { SubmitNoteRequest, SubmitNoteResponse } from "./submit-note.js";

export type SubmitTransport = (request: SubmitNoteRequest) => Promise<SubmitNoteResponse>;

export class ResponseTimeout extends Error {
  constructor() {
    super("The note submission response timed out.");
  }
}

export async function submitWithRetry(
  send: SubmitTransport,
  request: SubmitNoteRequest,
): Promise<SubmitNoteResponse> {
  try {
    return await send(request);
  } catch (error) {
    if (!(error instanceof ResponseTimeout)) {
      throw error;
    }
    return send(request);
  }
}
