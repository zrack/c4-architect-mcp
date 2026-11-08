import assert from "node:assert/strict";
import { InMemoryNoteRepository, RequestKeyConflict } from "./note-repository.js";
import { submitNote, type SubmitNoteRequest } from "./submit-note.js";
import { ResponseTimeout, submitWithRetry, type SubmitTransport } from "./trail-client.js";

const repository = new InMemoryNoteRepository();
const request: SubmitNoteRequest = {
  authorId: "hiker-7",
  requestKey: "trail-report-202",
  draft: { trailId: "ridge-loop", body: "The footbridge is closed." },
};

const attempts: string[] = [];
let originalNoteId: string | undefined;
const send: SubmitTransport = async (submission) => {
  attempts.push(submission.requestKey);
  const response = submitNote(repository, submission);
  if (attempts.length === 1) {
    assert.equal(repository.size, 1);
    originalNoteId = response.noteId;
    console.log(`First attempt saved ${response.noteId}; simulated timeout lost the response.`);
    throw new ResponseTimeout();
  }
  return response;
};

const response = await submitWithRetry(send, request);
assert.deepEqual(attempts, [request.requestKey, request.requestKey]);
assert.equal(response.noteId, originalNoteId);
assert.equal(repository.size, 1);
console.log(`Retry used ${request.requestKey} and returned ${response.noteId}; stored notes: ${repository.size}.`);

await assert.rejects(
  submitWithRetry(send, { ...request, draft: { ...request.draft, body: "The bridge is open." } }),
  RequestKeyConflict,
);
assert.equal(attempts.length, 3);
assert.equal(repository.size, 1);
console.log("Changing the draft under the same key was rejected without a retry.");
