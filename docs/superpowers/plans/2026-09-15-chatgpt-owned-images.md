# ChatGPT-Owned Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ChatGPT the exclusive lesson-image generator and retain exactly one server-side OpenAI Speech API call for each complete accepted lesson.

**Architecture:** ChatGPT passes one managed image file per slide. The server validates that image coverage before it creates the audio track, stores only the generated audio in a short-lived signed asset store, and returns no widget on validation or voice failure.

**Tech Stack:** Node.js 20, MCP SDK, Zod, Node test runner, OpenAI Speech API.

**Spec:** `docs/superpowers/specs/2026-09-15-chatgpt-owned-images-design.md`

## Global Constraints

- Never call the OpenAI Images API in the production lesson path.
- The sole paid request made by server code is one `gpt-4o-mini-tts` request after image validation.
- Logs include only voice provider, HTTP status, bounded error code, and generic message.
- A production lesson requires one ChatGPT-managed image per slide and one ready audio asset.

---

### Task 1: Enforce ChatGPT image coverage before voice generation

**Files:**
- Modify: `lesson.js`
- Modify: `test/lesson.test.js`

**Interfaces:**
- Consumes: `args.images` as ChatGPT-managed file objects.
- Produces: `buildLesson(args, options)` throws when non-demo image count differs from slide count.

- [ ] **Step 1: Write a failing coverage test**

```js
assert.throws(
  () => buildLesson({ ...input, images: input.images.slice(0, 2) }),
  /requires one image per slide/
);
```

- [ ] **Step 2: Run the focused test and observe failure**

Run: `npm test -- test/lesson.test.js`

Expected: the new test fails because host-managed images are not required unless prepared server images exist.

- [ ] **Step 3: Make the minimum validation change**

```js
if (!isDemo && images.length !== args.slides.length) {
  throw new RangeError("AskLilOwl requires one image per slide before it can show a lesson.");
}
```

- [ ] **Step 4: Re-run focused test**

Run: `npm test -- test/lesson.test.js`

Expected: PASS.

### Task 2: Replace image-and-audio service with audio-only storage

**Files:**
- Delete: `lesson-assets.js`
- Create: `lesson-audio.js`
- Delete: `test/lesson-assets.test.js`
- Create: `test/lesson-audio.test.js`

**Interfaces:**
- Consumes: `prepare({ narration, audience })` and an enabled speech service.
- Produces: `{ audioUrl, voice }` or throws a sanitized voice-provider error.

- [ ] **Step 1: Write a failing audio-only service test**

```js
const result = await service.prepare({ narration: "Glass starts as sand.", audience: "general" });
assert.match(result.audioUrl, /^https:\/\/lesson\.example\/api\/assets\//);
assert.equal(providerCalls, 1);
```

- [ ] **Step 2: Run it and observe failure**

Run: `npm test -- test/lesson-audio.test.js`

Expected: FAIL because `lesson-audio.js` does not exist.

- [ ] **Step 3: Implement short-lived audio-only storage**

```js
async function prepare({ narration, audience }) {
  const audio = await speechService.generate({ narration, audience });
  const asset = put(audio.bytes, audio.contentType, "asklilowl-lesson.mp3");
  return { audioUrl: asset.url, voice: speechService.metadata() };
}
```

- [ ] **Step 4: Re-run focused test**

Run: `npm test -- test/lesson-audio.test.js`

Expected: PASS with exactly one speech-service call and no image request interface.

### Task 3: Restore ChatGPT-native image handoff in the MCP tool

**Files:**
- Modify: `server.js`
- Modify: `test/http-server.test.js`

**Interfaces:**
- Consumes: complete lesson plus `images.length === slides.length`.
- Produces: one prepared audio URL after validation; generic retry error for missing images or voice failure.

- [ ] **Step 1: Write failing server tests**

```js
assert.equal(missingImages.isError, true);
assert.equal(speechCalls, 0);
assert.equal(completeLesson.structuredContent.lesson.images.length, 3);
assert.equal(speechCalls, 1);
```

- [ ] **Step 2: Run focused test and observe failure**

Run: `npm test -- test/http-server.test.js`

Expected: FAIL because the handler currently invokes image-and-audio preparation instead of validating ChatGPT images first.

- [ ] **Step 3: Implement the corrected handler**

```js
buildLesson(args); // validates host-managed image coverage before billing
const prepared = await audioService.prepare({ narration, audience: args.audience });
lesson = buildLesson(args, prepared);
```

- [ ] **Step 4: Remove obsolete image API and deferred speech routes**

Remove `createLessonAssetService`, `OPENAI_IMAGE_*` references, and `/api/speech/:token`. Retain `/api/assets/:token` solely for prepared audio bytes.

- [ ] **Step 5: Re-run focused test**

Run: `npm test -- test/http-server.test.js`

Expected: PASS; tests prove no speech call happens before valid images and only voice failures are logged.

### Task 4: Align documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: package and test references as required by deleted image service.

- [ ] **Step 1: Remove image API configuration and state the final ownership contract**

Document that ChatGPT creates slide images, Render-hosted AskLilOwl code requests only one Nova voice track, and a failed visual or voice precondition returns no partial lesson.

- [ ] **Step 2: Run full verification**

Run: `npm test; npm run test:evals; npm run test:package; git diff --check`

Expected: all tests, evals, package validation, and whitespace check pass.

- [ ] **Step 3: Commit**

```bash
git add lesson.js lesson-audio.js server.js README.md .env.example test docs/superpowers
git rm lesson-assets.js test/lesson-assets.test.js
git commit -m "Restore ChatGPT-owned lesson images"
```
