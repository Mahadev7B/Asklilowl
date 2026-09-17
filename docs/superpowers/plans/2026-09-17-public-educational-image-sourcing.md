# Public Educational Image Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source one obvious, relevant, reusable public educational image per slide without a paid image-generation API or dependency on native ChatGPT image handoff.

**Architecture:** ChatGPT supplies lesson content and a concrete visual intent per slide. AskLilOwl searches Wikimedia Commons through its API when a valid attributed image is absent, filters candidates through an explicit commercial-safe license policy, ranks common-sense relevance before format, converts SVG originals to official PNG previews, then feeds all winning raster URLs through the existing secure atomic proxy before making the single narration request.

**Tech Stack:** Node.js 20+, native `fetch`, Zod, MCP Apps SDK, MediaWiki API, Node test runner, JSDOM.

**Spec:** `docs/superpowers/specs/2026-09-17-public-educational-image-sourcing-design.md`

## Global Constraints

- Relevance and educational clarity rank before image format.
- Use only Public Domain, CC0, CC BY 2.0+, or CC BY-SA 2.0+ assets.
- Reject non-commercial, no-derivatives, fair-use, or unknown-license assets.
- Use official raster previews for SVG originals; never deliver SVG bytes to the widget.
- Do not scrape arbitrary webpages or call any image-generation API.
- Preserve one image per slide and the all-or-nothing lesson experience.
- Prepare all images before the one narration API request.
- Preserve HTTPS, DNS, redirect, private-address, MIME, size, timeout, concurrency, and cache protections.

---

### Task 1: Visual requests, license policy, and relevance ranking

**Files:**
- Create: `public-images.js`
- Create: `test/public-images.test.js`

**Interfaces:**
- Produces: `buildVisualRequest({ topic, audience, slide })`.
- Produces: `normalizeWikimediaCandidate(page, position)`.
- Produces: `rankPublicImageCandidates(request, candidates)`.
- Produces: `isAllowedPublicLicense(candidate)`.

- [ ] **Step 1: Write failing behavior tests**

```js
test("exact common-sense subject matches outrank decorative matches and format", () => {
  const request = buildVisualRequest({
    topic: "area of a regular octagon",
    audience: "general learner",
    slide: { title: "Eight equal triangles", body: "Divide the octagon into eight triangles.", imagePrompt: "regular octagon divided into eight equal triangles" },
  });
  const ranked = rankPublicImageCandidates(request, [
    candidate({ title: "Octagonal building photograph", mimeType: "image/jpeg" }),
    candidate({ title: "Regular octagon divided into triangles", mimeType: "image/svg+xml", rasterUrl: "https://upload.wikimedia.org/preview.png" }),
  ]);
  assert.equal(ranked[0].title, "Regular octagon divided into triangles");
});

test("commercial-safe licenses pass and restricted licenses fail", () => {
  assert.equal(isAllowedPublicLicense({ licenseName: "CC0 1.0" }), true);
  assert.equal(isAllowedPublicLicense({ licenseName: "CC BY-SA 4.0" }), true);
  assert.equal(isAllowedPublicLicense({ licenseName: "CC BY-NC-SA 4.0" }), false);
  assert.equal(isAllowedPublicLicense({ licenseName: "Fair use" }), false);
});
```

- [ ] **Step 2: Run `node --test test/public-images.test.js` and verify failures identify missing exports.**

- [ ] **Step 3: Implement normalized token matching, visual-kind hints, hard license gates, and stable tie-breaking by dimensions and provider position.**

```js
export function buildVisualRequest({ topic, audience, slide }) {
  return {
    query: [slide.imagePrompt, slide.title, topic].filter(Boolean).join(" "),
    topic,
    audience,
    visualKind: /diagram|label|divide|triangle|graph|map/i.test(`${slide.imagePrompt} ${slide.body}`) ? "diagram" : "subject",
  };
}
```

- [ ] **Step 4: Run the focused tests and confirm they pass.**

### Task 2: Wikimedia Commons provider

**Files:**
- Modify: `public-images.js`
- Modify: `test/public-images.test.js`

**Interfaces:**
- Consumes: `buildVisualRequest`, `normalizeWikimediaCandidate`, `rankPublicImageCandidates`.
- Produces: `createWikimediaImageProvider({ fetchImpl, timeoutMs, logger }).find(request)` returning one attributed HTTPS raster candidate or `null`.

- [ ] **Step 1: Add failing fixture-based tests for exact-match selection, license filtering, SVG-to-PNG preview selection, malformed responses, HTTP failure, and timeout.**

```js
const provider = createWikimediaImageProvider({
  fetchImpl: async () => Response.json(wikimediaFixture),
});
const result = await provider.find(buildVisualRequest(octagonSlide));
assert.equal(result.download_url, "https://upload.wikimedia.org/octagon-preview.png");
assert.equal(result.license_name, "CC0 1.0");
assert.equal(result.source_page_url, "https://commons.wikimedia.org/wiki/File:Octagon.svg");
```

- [ ] **Step 2: Run the focused tests and verify they fail because the provider is absent.**

- [ ] **Step 3: Implement bounded MediaWiki API search with `generator=search`, namespace 6, `imageinfo`, `extmetadata`, `iiurlwidth=1200`, a small result limit, and `AbortController`. Use `thumburl` for SVG originals and reject candidates without safe raster output.**

- [ ] **Step 4: Run the focused tests and confirm they pass.**

### Task 3: Atomic provider fallback and attribution contract

**Files:**
- Modify: `lesson-schema.js`
- Modify: `lesson.js`
- Modify: `lesson-images.js`
- Modify: `server.js`
- Modify: `test/lesson-schema.test.js`
- Modify: `test/lesson.test.js`
- Modify: `test/lesson-images.test.js`
- Modify: `test/http-server.test.js`

**Interfaces:**
- Consumes: `createWikimediaImageProvider().find(request)`.
- Produces: `imageService.prepareForLesson({ topic, audience, slides, images })`.
- Produces normalized output metadata: `sourcePageUrl`, `creator`, `licenseName`, `licenseUrl`, `sourceOrganization`, `description`, and `title`.

- [ ] **Step 1: Add failing schema tests proving attributed public candidates are accepted, unknown fields remain rejected by strict validation, and output attribution survives normalization.**

- [ ] **Step 2: Add failing image-service tests proving missing images trigger one provider lookup per slide, valid attributed supplied images are retained, SVG originals use raster previews, and one failed lookup commits no assets.**

- [ ] **Step 3: Add a failing MCP integration test proving a three-slide call with no `images` obtains three public candidates before one narration request and returns three proxied raster URLs.**

- [ ] **Step 4: Run the focused tests and verify failures are caused by the missing fallback and metadata.**

- [ ] **Step 5: Extend the permissive diagnostic boundary with named attribution fields while keeping strict handler validation. Add attribution to normalized output.**

- [ ] **Step 6: Implement `prepareForLesson` as a transactional wrapper around the existing staging/proxy logic. It builds slide visual requests, validates attributed supplied candidates, queries the provider when necessary, and commits only after all raster downloads succeed.**

- [ ] **Step 7: Wire the production HTTP server to the Wikimedia provider. Change `create_lesson` instructions so ChatGPT focuses on accurate content and concrete `imagePrompt` values; public image sourcing belongs to AskLilOwl. Remove native image generation as a requirement while retaining optional `file_id` compatibility.**

- [ ] **Step 8: Move the preflight `buildLesson` call after image preparation so missing incoming images can be filled before atomic lesson validation. Confirm narration still starts only after all images succeed.**

- [ ] **Step 9: Run all affected server, schema, lesson, and image tests until green.**

### Task 4: Image credits UI and atomic browser failure

**Files:**
- Modify: `public/lesson-widget.html`
- Modify: `test/widget.test.js`

**Interfaces:**
- Consumes: normalized image attribution fields on `lesson.images`.
- Produces: a compact `Image credits` details section with safe text nodes and HTTPS links.

- [ ] **Step 1: Add failing JSDOM tests proving credits display creator, license, and source per slide, omit absent optional labels without empty links, and use `textContent` rather than injected HTML.**

- [ ] **Step 2: Run `node --test test/widget.test.js` and verify the new assertions fail.**

- [ ] **Step 3: Add the credits container, styling, safe DOM rendering, and link protocol checks. Keep the existing image `error` handler routed to the single lesson-unavailable state.**

- [ ] **Step 4: Run widget tests and confirm they pass.**

### Task 5: Full verification, deployment, and visible lesson test

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `submission/live-test-results.md`

**Interfaces:**
- Documents: Wikimedia provider timeout/result limit and production behavior.
- Verifies: deployed public search, complete lesson rendering, one narration request, attribution, and API balance.

- [ ] **Step 1: Add configuration documentation for public image sourcing without secrets or paid API credentials.**

- [ ] **Step 2: Run `npm test`, `npm run test:evals`, `npm run test:package`, `npm audit --omit=dev`, and `git diff --check`.**

- [ ] **Step 3: Review the complete diff for unrelated changes, unsafe logging, weakened network checks, SVG delivery, missing attribution, and narration-before-images regressions.**

- [ ] **Step 4: Commit and push the implementation to `codex/launch-readiness`, verify the Render deployment becomes live, and refresh the ChatGPT plugin contract.**

- [ ] **Step 5: Record the available OpenAI API balance, open AskLilOwl visibly, submit one plain educational question with no special instructions, and wait for the complete lesson.**

- [ ] **Step 6: Verify Render logs show provider search and raster proxy completion before one narration request. Confirm the widget shows every slide image, lesson text, voice controls, quiz, and image credits.**

- [ ] **Step 7: Recheck the API balance after reporting delay and append the factual result to `submission/live-test-results.md`.**

