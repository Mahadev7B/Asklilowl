# AskLilOwl OpenAI TTS Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, high-quality OpenAI narration that stays synchronized with AskLilOwl lesson text, images, navigation, and quiz flow.

**Architecture:** `create_lesson` will derive or accept narration and issue signed, expiring server URLs. A focused `speech.js` module will validate those URLs, call OpenAI's speech endpoint, cache MP3 bytes, and normalize failures. The widget will use one HTML audio element and one user gesture to coordinate playback with slide state.

**Tech Stack:** Node.js 20 ESM, native HTTP/fetch/crypto/zlib, Zod, MCP Apps, HTML/CSS/JavaScript, node:test, JSDOM, Render.

**Spec:** `docs/superpowers/specs/2026-09-14-openai-tts-voice-design.md`

## Global Constraints

- Default model is `gpt-4o-mini-tts`; default voice is `marin`; response format is MP3.
- Narration is at most 2,000 characters per slide and lessons remain capped at 20 slides.
- The browser never receives the OpenAI API key and never calls OpenAI directly.
- Audio is requested only after Start lesson or explicit replay.
- Missing configuration or provider failure must leave text, images, quiz, and sources usable.
- Automated tests must not consume API credit; exactly one medium-depth lesson is used for the paid live test.
- The widget visibly discloses `AI-generated voice.`

---

### Task 1: Speech contracts and signed URLs

**Files:**
- Create: `speech.js`
- Modify: `lesson-schema.js`
- Modify: `lesson.js`
- Test: `test/speech.test.js`
- Test: `test/lesson.test.js`

**Interfaces:**
- Produces: `createSpeechService(options)` with `enabled`, `metadata()`, `createAudioUrl(input)`, and `handleHttpRequest(request, response, token)`.
- Consumes: `buildLesson(args, { isDemo, speechService })`.

- [ ] Write tests asserting optional narration validation, deterministic fallback narration, disabled voice metadata, signed URL issuance, valid/altered/expired/oversized token behavior, and exact provider request fields.
- [ ] Run `node --test test/speech.test.js test/lesson.test.js` and confirm failures identify the missing speech contracts.
- [ ] Implement HMAC-SHA256 signing, constant-time verification, bounded compressed payloads, configuration defaults, and lesson voice metadata.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Secure streaming speech endpoint

**Files:**
- Modify: `speech.js`
- Modify: `server.js`
- Test: `test/http-server.test.js`

**Interfaces:**
- Consumes: `speechService.handleHttpRequest(request, response, token)` for `/api/speech/:token`.
- Produces: GET streaming/cached MP3, HEAD availability, 405 for other methods, normalized errors, and speech-specific rate limiting.

- [ ] Write HTTP tests using an injected provider fetch for GET, HEAD, cache reuse, concurrent duplicate rejection, malformed/expired tokens, missing configuration, provider failure, and rate limiting.
- [ ] Run `node --test test/http-server.test.js` and confirm the new cases fail for the missing route.
- [ ] Register the speech route before MCP routing, permit the public origin in widget connect domains, stream while accumulating at most 4 MiB, and enforce a 32 MiB LRU cache.
- [ ] Re-run HTTP tests and confirm they pass without external requests.

### Task 3: Synchronized voice experience

**Files:**
- Modify: `public/lesson-widget.html`
- Test: `test/widget.test.js`

**Interfaces:**
- Consumes: `lesson.slides[].narration`, `lesson.slides[].audioUrl`, and `lesson.voice`.
- Produces: Start, pause/resume, replay, mute/unmute, loading/error status, transcript, disclosure, and slide/audio synchronization.

- [ ] Write JSDOM tests with a controlled audio element that prove Start begins the current slide, ended advances, manual navigation switches audio, quiz stops audio, replay reuses the URL, mute toggles, and failure preserves navigation.
- [ ] Run `node --test test/widget.test.js` and confirm the new cases fail because voice controls are absent.
- [ ] Add accessible controls and status UI; coordinate one audio element with render, navigation, quiz, and review state.
- [ ] Re-run widget tests and confirm they pass.

### Task 4: Product, privacy, and deployment configuration

**Files:**
- Modify: `README.md`
- Modify: `public/privacy.html`
- Modify: `.env.example`
- Modify: `render.yaml`
- Modify: `evals/cases.json`
- Test: `test/package.test.js`
- Test: `test/evals.test.js`

**Interfaces:**
- Documents: narration text is sent to OpenAI; audio is streamed without database retention; images and quiz answers are not sent for TTS.
- Configures: `OPENAI_API_KEY`, `VOICE_TOKEN_SECRET`, and optional TTS overrides.

- [ ] Add failing package/eval assertions for disclosure, privacy copy, environment names, and voice-capable lesson cases.
- [ ] Run `npm run test:package` and `npm run test:evals` and confirm the new assertions fail.
- [ ] Update documentation, privacy copy, example configuration, Render secret declarations, and evaluation cases.
- [ ] Re-run package/eval validation and confirm both pass.

### Task 5: Verification, deployment, and one paid medium-depth test

**Files:**
- Modify: `submission/live-test-results.md`

**Interfaces:**
- Deploys: branch `codex/launch-readiness` to `asklilowl-chatgpt.onrender.com`.
- Verifies: one “How does photosynthesis work?” medium-depth lesson with description, educational images, narration, and quiz.

- [ ] Run `npm test`, `npm run test:evals`, and `npm run test:package`; require zero failures and no paid calls.
- [ ] Verify the staged diff contains no credentials and commit only voice-related files.
- [ ] Correct Render key name to `OPENAI_API_KEY`, create a cryptographically random `VOICE_TOKEN_SECRET`, deploy, and verify `/healthz`.
- [ ] Call `create_lesson` once with the medium-depth fixture, request one narration through the deployed signed URL, and confirm MP3 content, nonzero bytes, and acceptable latency.
- [ ] Open the deployed widget output for the user and record observed results and any remaining blockers in `submission/live-test-results.md`.
