# Task 5 offline release-verification report

## Scope completed

- Added package-validator checks for `diagram-worker.js`, `assets/fonts/NotoSans-Regular.ttf`, and `assets/fonts/OFL.txt`.
- Added a negative package fixture proving that omission of any required diagram runtime file is rejected.
- Updated the current workflow documentation: a fresh style choice for every new lesson, conversational follow-ups, native-first visuals, and the suitable-topic-only structured diagram fallback.
- Documented the supported templates, bundled-font restriction, 2-second diagram and 10-second lesson timeouts, one-job process limit, hosting CPU/memory cost, no image-generation API, and no raw SVG/widget payload.
- Updated the design status to “implemented locally; release verification pending.” No historical test outcome was rewritten and no Test 32 record was created because live testing has not started.

## TDD evidence

RED:

```text
node --test test/package.test.js
FAIL package validation rejects missing diagram runtime files
Expected the three required-file errors; actual errors were [].
2 passed, 1 failed; exit 1.
```

GREEN after the minimal validator change:

```text
node --test test/package.test.js
3 passed, 0 failed; exit 0.
```

The realistic mutation is removal or omission of the worker, font, or license from a packaged tree. The negative test catches that production packaging failure through the real validator.

## Fresh local verification

Environment observed locally:

```text
Node v22.13.1; win32 x64
@resvg/resvg-js@2.6.2 is installed as a production dependency.
```

Commands and outcomes:

```text
npm test
147 tests passed, 0 failed; exit 0.

npm run test:evals
Validated 17 AskLilOwl evaluation cases; exit 0.

npm run test:package
Validated the package with 2 raster identity assets; exit 0.

npm pack --dry-run --json --ignore-scripts --cache .npm-cache
exit 0; package listing includes diagram-worker.js, NotoSans-Regular.ttf,
OFL.txt, diagram modules, package.json, and server runtime files.

npm ls @resvg/resvg-js --omit=dev
@resvg/resvg-js@2.6.2; exit 0.

git diff --check
exit 0 (Git emitted only Windows LF-to-CRLF conversion warnings).
```

The controller separately confirmed the protected dirty files `public-images.js`, `test/public-images.test.js`, and `submission/test-29-native-lesson.md` retained their prior SHA-256 hashes. This task did not edit them.

## Gates intentionally left open

- Linux is unavailable on this machine: WSL reports that the subsystem is not installed and Docker is absent. Therefore locked installation and real renderer verification on the Render-compatible Linux/Node 20 runtime remain pending. `render.yaml` pins Node 20 and uses `npm ci --omit=dev`; it was not edited.
- No deployment, billing/hosting change, API call, paid narration/image use, or live ChatGPT test was performed.
- Test 32 (supervised Chat diagram lesson) and the separately numbered native Work regression remain pending. Offline tests do not prove that the host will ask for style, select the diagram tool, preserve native behavior, or complete the full interactive experience.
- The requested independent code-review dispatch was not performed because this task explicitly prohibited agents. The controller will perform the final focused review and decide whether external deployment may proceed.

Offline result: local package, workflow documentation, Windows tests, evals, and dry-run contents are verified. Release readiness is not claimed until the Linux and supervised live gates pass.

## Focused review fix round 1

The controller's focused review approved the remaining requirements and identified one Important documentation omission: the README did not state the exact combined 4,096-character narration bound beside the shared 3–20-slide and quiz contract. The README now states that exact bound and makes clear that it applies to both native and diagram lesson flows.

This was a prose-only correction, so no behavior test or full-suite rerun was added. File-line inspection verified the updated shared contract. `git diff --check` exited 0 and emitted only the existing Windows warning: `LF will be replaced by CRLF the next time Git touches it` for the edited README and report; no global or repository line-ending configuration was changed.
