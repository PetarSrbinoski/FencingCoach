# Voice logging

Use **Nutrition → Diary → Record voice** to describe what you ate or dictate food
label values. Review the transcription and interpretation before saving a food or
logging consumption. Text entry and the saved-food library remain available.

Correct a transcription to generate a fresh interpretation, or edit the interpreted
amounts and nutrients and update the review. Choose the destination day and meal
when logging. Completed actions have a receipt and guarded undo.

## Provider and limits

- Speech transcription uses the OpenAI-compatible audio transcription API through `AsyncOpenAI`, separate from the configured text model. Set `VOICE_TRANSCRIPTION_API_KEY`; optionally set `VOICE_TRANSCRIPTION_BASE_URL` and `VOICE_TRANSCRIPTION_MODEL` (default `whisper-1`). The text model interprets the returned transcript as a structured draft. A missing speech key surfaces as a failed draft with a clear error.
- The browser records WebM, MP4, or Ogg where supported. The API also accepts MP3 and WAV. The client stops recording at 60 seconds; the API rejects empty recordings, unsupported MIME types, and recordings above 10 MiB. `GET /nutrition/voice/options` exposes these limits and speech-provider availability.
- Audio exists only in request and background-task memory while transcription runs. No file or database column stores it. The transcript, interpretation, status, and revision persist until the draft is cancelled or removed by a future retention policy. Cancelling clears the interpretation. A server restart marks pending drafts as failed, so they cannot be accepted accidentally.

## Workflow

`POST /nutrition/voice` creates a processing draft; poll `GET /nutrition/voice/{id}`. Correct speech with `PUT /{id}/transcript`, which invalidates the old interpretation and starts a new one. Edit interpreted nutrients or amounts with `PUT /{id}/review`; the server recalculates the preview and changes the draft revision. `POST /{id}/accept` requires that revision and one explicit action. Saving uses the existing saved-food service and never logs consumption. Logging requires a reviewed day, meal, and amount. Both commit a corresponding Agent log receipt atomically, and repeated acceptance returns the existing receipt. `POST /{id}/cancel` prevents acceptance.

Dictated label values may be per 100 g or per serving. The server converts the latter using an explicit gram weight, preserving missing values as `null` and keeping IU separate from mass units. Logging a saved food uses its current reviewed revision and the existing deterministic portion calculation. The draft cannot be accepted if that food changes in the meantime.
