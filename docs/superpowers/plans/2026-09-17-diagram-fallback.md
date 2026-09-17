# Safe Diagram Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish suitable lessons using locally rendered diagrams when native image generation is unavailable, without weakening native image handoff.

**Architecture:** Add a separate strict diagram tool. Trusted templates become PNGs in a bounded child-process worker, enter the existing temporary image cache as an atomic batch, then use shared lesson finalization and the existing single narration request.

**Tech Stack:** Node >=20 ES modules, Zod, MCP SDK, node:test, @resvg/resvg-js, bundled openly licensed Noto Sans.

**Spec:** `docs/superpowers/specs/2026-09-17-diagram-fallback-design.md` (approved by user September 17).

## Global Constraints

- Preserve `create_lesson`, its required native-file array, and file metadata unchanged.
- Preserve 3–20 slides, required quiz, and the combined 4,096-character narration limit.
- One visual mode per lesson; exactly one diagram per slide.
- Fixed 1200x675 canvas. Strict tagged JSON; no input SVG, coordinates, paths, CSS, fonts, URLs, HTML, or code.
- One active rendering job per service process; reject excess work. Two seconds per diagram, ten seconds per lesson; terminate on timeout.
- Cache: 15-minute TTL, 5 MiB/image, 20 MiB/lesson, 32 MiB total. Stage before publishing.
- No image API, public-image search, raw SVG in widget output, or local asset loopback fetch.
- Validate content before rendering; prepare every visual before the single paid narration request.
- Preserve browser all-or-nothing failure behavior and audio provider/model/voice.
- Do not edit unrelated `public-images.js`, `test/public-images.test.js`, or the Test 29 record.
- Offline verification first. No paid live test until the user can watch and current prepaid balance has been read. Next live test is 32.
- Ask lesson style before EVERY new lesson: Auto / Default, Kid-friendly, Engineering / Technical, Professional. Follow-ups receive conversational help; another lesson requires consent then a fresh style choice. No automatic paid generation for follow-ups.

## File ownership and interfaces

New `diagram-schema.js`: strict diagram grammar and diagram lesson parsing.
New `diagram-svg.js`: deterministic trusted templates and text layout only.
New `diagram-worker.js`: fixed-font rasterization in a child process, no model-controlled file paths.
New `lesson-diagrams.js`: single-job admission, subprocess lifecycle, timeouts and PNG output validation.
Modify `lesson-images.js`: batch admission of already-rendered PNG buffers, sharing its cache.
Modify `lesson.js`: export reusable content-only preflight; retain existing output semantics.
Modify `server.js`: diagram tool plus shared finalization; native input/metadata unchanged.
Modify `lesson-schema.js` and `public/lesson-widget.html`: optional visual-mode disclosure, preserving existing native behavior.
Modify package manifests and package validation assets only as required to ship worker/font.

## Task 1: Strict input and content preflight

**Files:** create `diagram-schema.js`, `test/diagram-schema.test.js`; modify `lesson.js`, `test/lesson.test.js`.

**Interfaces:** export `diagramSchema`, `diagramLessonInputShape`, `validateDiagramLessonInput(input)`; export `validateLessonContent(args)` from lesson.js (throws; no images required).

- [ ] Write red tests for flow 2–6 steps, comparison 2–3 groups/1–4 items, polygon 3–12 sides, missing quiz, invalid answer index, >4096 narration, mismatched counts, unknown fields, and text injection.

```js
assert.equal(diagramSchema.parse({kind:'flow', title:'Save tokens', steps:['Select context','Ask clearly']}).kind, 'flow');
assert.throws(() => diagramSchema.parse({kind:'geometry', title:'Shape', sides:2}));
assert.throws(() => diagramSchema.parse({kind:'flow', title:'Test', steps:['A','B'], svg:'<svg/>'}));
assert.throws(() => diagramSchema.parse({kind:'flow', title:'Test', steps:['https://example.com','B']}));
```

- [ ] Run `node --test test/diagram-schema.test.js`; verify missing exports fail.
- [ ] Implement strict discriminated union using `.strict()` at every object level. Bounds: titles 60 characters; flow steps 64; group labels 32, items 64; geometry labels 24; captions 120. Trim, reject controls, markup delimiters, URL schemes and unbroken tokens longer than 24 characters; escape again in renderer. Optional geometry fields: `triangulate:boolean`, `sideLabel:string`, `apothemLabel:string`, `caption:string`. Comparison groups use `{label,items}`.

```js
const { images, ...contentShape } = lessonInputShape;
export const diagramLessonInputShape = {
  ...contentShape,
  diagrams: z.array(diagramSchema).min(3).max(20),
};
// validateDiagramLessonInput parses a strict object, checks count equality,
// then calls validateLessonContent before returning parsed arguments.
```

- [ ] Extract quiz/narration checks from buildLesson into `validateLessonContent`; call it from buildLesson so native checks remain. No fabricated file IDs or placeholder images for preflight.
- [ ] Run schema and existing lesson tests; review diff; commit only these files after green.

## Task 2: Trusted templates and isolated rasterization

**Files:** create `diagram-svg.js`, `diagram-worker.js`, `lesson-diagrams.js`, `test/lesson-diagrams.test.js`, `assets/fonts/NotoSans-Regular.ttf`, `assets/fonts/OFL.txt`; modify package manifests.

**Interfaces:** `renderDiagramSvg(diagram):string`; `createDiagramService({logger, workerFactory?, now?})` returns `{renderMany(diagrams):Promise<Buffer[]>}`. Worker receives `{id,diagram}` and returns `{id,pngBase64}` or `{id,errorCode}`. Never sends labels back in errors.

- [ ] Add failing template tests for escaped text, exact viewBox, polygon vertex count, no external references and overflow rejection. Add process-controller tests using an injected controllable workerFactory for busy rejection, timeout, worker error, partial failure and cleanup.

```js
const svg = renderDiagramSvg({kind:'geometry',title:'An octagon',sides:8,triangulate:true});
assert.match(svg, /viewBox="0 0 1200 675"/);
assert.match(svg, /not to scale/i);
assert.doesNotMatch(svg, /<image|foreignObject|<script|href=/i);
```

- [ ] Run `node --test test/lesson-diagrams.test.js`; verify red.
- [ ] Review the upstream resvg-js README/types and registry release using `npm view @resvg/resvg-js version engines dist.integrity`. After reviewing that release, install with `npm install --save-exact @resvg/resvg-js`; verify package.json pins the reviewed version and the lockfile integrity agrees. Record version and upstream source in test notes. Obtain Noto Sans Regular and OFL from official google/fonts; keep font binary and license together; record source and SHA256. No system-font dependence.
- [ ] Implement templates: title baseline 70; content bounds x60–1140/y120–560; caption below590. Flow uses a maximum three-column/two-row serpentine grid and explicit arrows. Comparison uses equal-width columns. Geometry uses center(600,335), radius210, vertices calculated with sine/cosine, optional radial lines and labels outside polygon. Fixed palette, 30px body, 40px title, 24px caption. Greedy deterministic wrapping uses measured font widths with a margin; throw on overflow rather than truncation.
- [ ] Rasterize with fixed local font:

```js
const png = new Resvg(renderDiagramSvg(diagram), {
  font: {fontFiles:[fontPath],loadSystemFonts:false,defaultFontFamily:'Noto Sans'},
}).render().asPng();
```

- [ ] Use `fork()` with a fixed worker path and JSON IPC, not a shell or worker-thread-only cancellation: killing the child bounds synchronous native render work too. Start one child per lesson, serialize diagrams, enforce both timers, kill/disconnect on all terminal paths, clear busy flag in finally. Reject base64 larger than the encoded 5MiB limit before decoding; verify PNG signature/dimensions and cumulative 20MiB bound. Do not log raw exceptions containing input.
- [ ] Generate three local fixtures (flow, comparison, octagon) using the real renderer; inspect all PNGs visually including maximum-label examples. Tests must assert 1200×675 and PNG signature. Save fixtures only under a temporary QA directory, not as production fallback assets.
- [ ] Run focused tests, review dependency/license and resource bounds; commit the reviewed task files after green.

## Task 3: Atomic local PNG cache admission

**Files:** modify `lesson-images.js`, `test/lesson-images.test.js`.

**Interfaces:** image service adds `storePngBatch(buffers):Array<{download_url,mime_type,file_name,size}>`; returns no fabricated native file IDs. URLs use existing `/api/images/:id` route.

- [ ] Add tests: invalid last PNG publishes nothing; >5MiB single and >20MiB batch reject; expiry; unique IDs across simultaneous users; successful batch remains resolvable; cache pressure does not evict part of the newly admitted batch.

```js
const stored = service.storePngBatch([pngA,pngB]);
assert.notEqual(stored[0].download_url,stored[1].download_url);
assert.equal(stored[0].mime_type,'image/png');
assert.equal(fetchCalls,0);
```

- [ ] Run focused tests red.
- [ ] Implement full batch validation before cache mutation; prune expired entries, evict older assets to reserve capacity, assign random UUIDs and a common TTL, then publish synchronously. Return only same-origin asset metadata; no diagram input in cache. Preserve existing native download behavior and its tests.
- [ ] Run `node --test test/lesson-images.test.js`; review and commit after green.

## Task 4: Diagram tool and shared finalization

**Files:** modify `server.js`, `lesson.js`, `lesson-schema.js`, `public/lesson-widget.html`, `test/lesson-workflow.test.js`, `test/widget.test.js`; create `test/diagram-workflow.test.js`.

**Interfaces:** server factory accepts injected `diagramService`; production factory supplies real renderer and existing cache. Shared `finalizeLesson(args, prepareImages, visualMode)` validates content, awaits visuals, validates built lesson, requests narration once, builds final output. Optional output `visualMode` enum `native|diagram`; native omissions retain old behavior.

- [ ] Write in-process InMemoryTransport tests: list tools exposes strict diagram schema/no fileParams; native schema/fileParams unchanged; successful diagram call has three resolvable PNG URLs and exactly one stub narration call; malformed/failed render calls have no structured lesson and zero narration calls. Assert payload contains neither raw diagrams nor SVG. Include renderer/cache failure and invalid quiz tests.

```js
assert.equal(audioCalls,1);
assert.equal(result.structuredContent.lesson.visualMode,'diagram');
assert.equal(result.structuredContent.lesson.images.length,3);
assert.doesNotMatch(JSON.stringify(result), /<svg|"diagrams"/);
```

- [ ] Run new tests red. Extract existing success/error formatting without changing native file validation. Register `create_diagram_lesson` with same widget resource and output schema, diagram strict shape, explicit native-first/suitable-subject instructions. Update prepare_lesson and server instructions to mention this route only when native generation genuinely unavailable; do not infer surface identity. Keep safety instructions.
- [ ] Extend only prepare_lesson input with optional `lessonStyle: z.enum(['auto','kid-friendly','technical','professional'])`. Without it return `ready:false`, `needsStyleSelection:true`, the four labeled choices, and instructions to ask before generating. With a selection return `ready:false`, `needsStyleSelection:false` and style-specific instructions. Native final input/file metadata remain unchanged. Use existing audience/imagePrompt fields to propagate the choice. Include instructions to ask every new lesson (no cached preference), to answer follow-ups conversationally with examples and gentle checks, and to offer another lesson without generating until consent plus fresh style selection. Prompt guidance cannot prove actual host compliance; do not claim otherwise.

```js
const prep = await client.callTool({name:'prepare_lesson',arguments:{question:'How do batteries work?'}});
const instruction = JSON.parse(prep.content[0].text);
assert.equal(instruction.needsStyleSelection,true);
assert.equal(instruction.styleOptions.length,4);
// Repeat after a selected-style preparation: it must still ask on a new lesson.
```

- [ ] Add tests for missing style on repeated preparations, all four selected styles, invalid enum, zero audio/render calls during preparation, and instructions distinguishing follow-up discussion from a consented new lesson. Update old workflow expectations only for the intentional new preparation gate.
- [ ] Shared completion sequence:

```js
validateLessonContent(args);
const images = await prepareImages();
buildLesson(args, {images});
const prepared = await audioService.prepare({
  narration:args.slides.map(slide=>slide.body).join('\n\n'),audience:args.audience,
});
return buildLesson(args,{...prepared,images,speechService,visualMode});
```

- [ ] Diagram prepareImages calls `diagramService.renderMany(args.diagrams)` then `imageService.storePngBatch`. Log only counts/kinds, durations, sizes and fixed failure codes; Zod diagnostics use paths/codes only, never messages/input. Boundary validation failures may occur before handler; do not claim complete rejected-call telemetry without transport-level support.
- [ ] Add small widget disclosure “Illustrative diagrams” for diagram mode using textContent. Keep existing image preload/all-or-nothing error, seeking, quiz and layout. Test label, no SVG nodes, and whole-lesson failure on image load rejection.
- [ ] Run workflow/widget/native regression tests; review and commit task files after green.

## Task 5: Release verification and supervised test

**Files:** update `scripts/validate-package.js` and relevant expectations in `test/package.test.js`, `test/evals.test.js` only when the additional tool/assets require it; update `README.md` for the new workflow; create `submission/test-32-diagram-lesson.md` when live testing starts.

- [ ] Update README workflow/tool sections: every new lesson asks style; follow-ups are conversational without automatic generation; native remains preferred; suitable topics may use strict local PNG diagrams through create_diagram_lesson. Document template/font/timeout limits and hosting CPU use, no image API, no raw SVG widget payload, and pending Linux/Chat verification. Preserve historical test records rather than rewriting their outcomes.

- [ ] Verify package includes static worker and font/license. Add concrete file-existence checks and run them red before implementation:

```js
for (const file of ['diagram-worker.js','assets/fonts/NotoSans-Regular.ttf','assets/fonts/OFL.txt']) {
  assert.equal(existsSync(new URL(`../${file}`,import.meta.url)),true);
}
```

- [ ] Run `npm test`, `npm run test:evals`, `npm run test:package`, `git diff --check`; retain outputs. Never change old tests just to hide a regression.
- [ ] Verify locked installation and real renderer on Linux using available Docker/CI or a separately approved staging deployment; record Node version/platform and rendered PNG dimensions. If no Linux environment is available, report the missing gate instead of claiming readiness.
- [ ] Request focused code review using requesting-code-review skill; address security/atomicity/native regression findings. Inspect diff against original dirty files and confirm they remain untouched.
- [ ] Report offline outcome before deployment. Deploy reviewed feature commits only through the existing branch/workflow; no hosting/billing changes. Refresh tools once deployment is confirmed.
- [ ] Run Test32 with the user watching and fresh prepaid balance captured: ordinary question “How can one save tokens within AI?” in Chat. Observe actual tool selection, relevant diagrams, text/voice match, seek and quiz. Capture Render correlation and delayed/rounded balance after; no automatic paid retries.
- [ ] Run a separately numbered native Work regression with user included. Do not call Chat support successful until full test passes. Record failed/blocked tests honestly; preserve the user's consecutive-success acceptance policy.

## Plan self-review

Schema, template suitability, worker limits, atomic cache, native contract, content preflight, safe logging, disclosure, offline transport tests, Windows/Linux checks and supervised rollout all map to tasks above. Interfaces agree: renderer returns buffers; cache accepts buffers; finalizer accepts prepared metadata. No image generation API is introduced. Dependency release selection is an explicit verification step, not an assumed version.
