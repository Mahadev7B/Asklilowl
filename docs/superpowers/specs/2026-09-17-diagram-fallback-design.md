# Safe diagram fallback for AskLilOwl

Status: proposed design for user review. No implementation or deployment yet.

## Approved direction

Keep native ChatGPT-generated images preferred. When native generation is not
available and a diagram can explain the topic accurately, allow ChatGPT to supply
structured diagram data. AskLilOwl renders it locally to PNG. The learner still
gets one complete lesson with images, matching narration, and a quiz.

This replaces the native-only policy with native-first plus a diagram fallback.
It does not enable ChatGPT image generation in Chat mode or guarantee tool use.

## Alternatives and decision

1. **Structured diagrams → server-generated SVG → PNG (recommended):** less
   expressive than free-form artwork, but validated, predictable, and no file
   handoff needed from ChatGPT.
2. Raw SVG from ChatGPT → PNG: more expressive, but requires a much broader
   untrusted-markup security boundary. Rejected for the initial release.
3. Keep native-only: preserves current Work behavior but leaves the tested Chat
   conversations unable to finish. Not the user's chosen direction.

## Tool boundary

- Preserve `create_lesson`, its required native-file array, and file metadata
  unchanged, so the proven Work handoff stays compatible.
- Add a separate `create_diagram_lesson` tool with the same lesson text/quiz/source
  rules and a required `diagrams` array, exactly one per slide in slide order.
  No file-parameter metadata on this tool; it accepts structured JSON only.
- One visual mode per lesson initially; do not mix files and diagrams. This
  avoids weakening the native-file contract or confusing host file rewriting.
- Both tools use a shared finalization path for preflight, one narration request,
  lesson construction, and the existing widget. Preserve 3–20 slides, required
  quiz, and the combined 4,096-character narration limit.
- Update preparation/tool instructions: native images when available; diagrams
  only when native generation is unavailable and the subject is suitable.
  Never infer capabilities solely from a Chat/Work label: the server does not
  have a verified surface-identification field.

## Initial diagram language

Strict tagged objects; reject unknown keys. Allow these three templates:

- `flow`: title, 2–6 short step labels, and a short optional caption. Fixed
  automatically laid-out boxes and arrows. Useful for token-saving workflows.
- `comparison`: title and 2–3 labeled groups with 1–4 short items each. Useful
  for before/after prompts, alternatives, and parts of a concept.
- `geometry`: title, a regular polygon with 3–12 sides, optional center-to-vertex
  triangulation, short side/apothem labels, and an optional formula caption.
  Draw mathematically from the side count; never claim arbitrary user values
  were computed or verified by the renderer. Mark illustrations not to scale.

Use a fixed 1200x675 canvas, bounded label lengths, a small fixed palette, generous
margins, and deterministic wrapping. No coordinates, paths, CSS, fonts, URLs,
HTML, SVG markup, or executable instructions accepted from the model. Escape all
text as text. Reject text that cannot fit rather than clipping it or truncating
its meaning. Geometry labels are plain text, not executable math or LaTeX.

Unsupported topics requiring photographs, complex anatomy, or realistic artwork
must not receive a misleading generic diagram. Report the lesson unavailable or
suggest Work mode for native illustrations instead. Do not promise every topic.

## Rendering and temporary storage

- Build SVG exclusively from trusted templates and escaped validated fields.
  Rasterize on the server with `@resvg/resvg-js`; pin the reviewed dependency
  version and retain its lockfile. Use an openly licensed bundled font and
  retain its license, with system-font loading disabled for consistent output.
- No external image references, file references from input, network resources,
  scripts, animation, foreign objects, or user-defined font/CSS data.
- Run rendering in a bounded worker with a hard timeout and one active job per
  service process. Reject excess concurrent work rather than building an
  unbounded queue. Limit one diagram to 2 seconds and a lesson to 10 seconds;
  terminate the worker on timeout. Check generated PNG size/signature.
- Stage all PNGs before publishing the batch to the existing temporary image
  store. Reuse its unique IDs, 15-minute TTL and byte limits (5 MiB per image,
  20 MiB per lesson, 32 MiB cache). Do not fetch local PNGs through public URLs.
- Return only same-origin PNG asset URLs to the widget. No SVG bytes or raw
  diagram payloads in widget-facing output. No public image search or image API.
- Validate lesson content and diagrams before rasterization; render all visuals
  before the existing single narration API call. Invalid diagrams spend no API
  credit. Voice generation still costs API credit; local rendering uses hosting
  resources and is not claimed to be free infrastructure.

## Errors and observability

- Any visual or narration preparation failure returns the existing whole-lesson
  unavailable result, never partial slides or placeholders. Keep browser image
  failure behavior unchanged.
- Log visual mode, diagram kinds/counts, validation field paths/codes, render
  duration, PNG byte counts, and safe failure codes. Never log lesson text,
  labels, SVG markup, tokens, or signed asset URLs.
- Label this visual mode as an illustrative diagram lesson; do not describe its
  visuals as native generated images or photographs.

## Validation and rollout

1. Test-first schemas: accept supported shapes; reject arbitrary SVG, unknown
   fields, URLs, excessive labels/elements, invalid polygons, and count mismatch.
2. Render tests and inspected PNG fixtures for flow, comparison, and octagon
   geometry; verify readability, complete text, math shape, and no clipping.
3. Offline in-process MCP calls: diagram path returns real PNG URLs; invalid input
   rejects before narration; native tool contract and existing tests stay intact.
4. Test worker timeout/concurrency, cache expiry/limits, and atomic failure.
5. Verify install/rendering on a Linux runtime compatible with Render as well as
   local Windows. Run full unit tests, evaluation and package checks, and review.
6. Only after these checks, deploy and refresh the plugin. Start the next numbered
   live test in Chat with the user's plain question about saving AI tokens.
   The user watches; report prepaid API balance before/after, distinguishing
   rounded/delayed balance changes from exact attributed cost.
7. A pass requires diagram tool invocation, complete relevant PNG visuals,
   matching narration with working seeking, and a usable quiz. Recheck native
   Work behavior separately. Do not claim Chat support until observed.

## Scope protection

No change to speech provider/model/voice, no image API, no arbitrary web scraping,
no raw SVG widget rendering, no default host-model changes, no deployment/billing
plan change, and no edits to the legacy website. Preserve unrelated dirty
`public-images.js`, `test/public-images.test.js`, and the Test 29 record.
