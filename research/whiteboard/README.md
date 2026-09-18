# Whiteboard Animation Research

Pinned, unmodified source snapshots for AskLilOwl's browser-playable educational
animation research. These are ordinary repository files, not submodules. They
are available immediately after cloning this branch.

Imported on 2026-09-18. Exact upstream commits, Git tree hashes, and file counts
are recorded in [sources.json](sources.json).

## Available Projects

| Project | Useful material | Upstream license |
| --- | --- | --- |
| [Inkplainer](vendor/inkplainer/README.md) | Classic drawing-hand animation, image/text reveals, hand sprites | [Apache-2.0](vendor/inkplainer/LICENSE) |
| [Excalimate](vendor/excalimate/README.md) | Browser diagram animation, draw-on arrows, timelines, reusable templates and player runtime | [MIT](vendor/excalimate/LICENSE) |
| [ExcaliMath](vendor/excalimath/README.md) | STEM artwork: fractions, geometry, circuits, cells, chemistry, equations and graphs | [MIT](vendor/excalimath/LICENSE) |
| [Ray Optics](vendor/ray-optics/README.md) | Browser optics simulation and saved scenes, including rainbows | [Apache-2.0](vendor/ray-optics/LICENSE) |

## Start Here

- Drawing engine: [Inkplainer animations.js](vendor/inkplainer/animations.js).
- Hand assets: [Inkplainer images](vendor/inkplainer/images/).
- Animated sequence: [Excalimate educational-explainer](vendor/excalimate/public/templates/v1/educational-explainer/).
- Template catalog: [Excalimate manifest](vendor/excalimate/public/templates/v1/manifest.json).
- Browser player: [Excalimate player-runtime](vendor/excalimate/packages/player-runtime/).
- STEM asset packs: [ExcaliMath generated libraries](vendor/excalimath/scripts/output/).
- Ready-made rainbow scene: [Ray Optics rainbows.json](vendor/ray-optics/data/galleryScenes/rainbows.json).
- Optics engine: [Ray Optics core](vendor/ray-optics/src/core/).

Inkplainer is the closest candidate for the requested classic hand-drawing style.
ExcaliMath supplies artwork, not finished animations. Excalimate's educational
template is a generic Question/Concept/Example/Recap diagram, not a narrated
science lesson. Ray Optics supplies a physics simulation, not a whiteboard hand
effect. Combining these materials still requires an AskLilOwl lesson/template
layer, narration timing, and visual validation.

## Scope and Reuse

- All tracked upstream files are preserved, including licenses and attribution.
- No dependencies have been installed and no upstream build scripts have been run.
- No project is wired into the AskLilOwl app or its runtime dependencies yet.
- Upstream package files and workflows remain nested inside their snapshots.
- Keep original license and attribution files when adapting or redistributing code
  or assets; retain any additional file-level or bundled third-party notices.
- The snapshots are research inputs, not security-audited production dependencies.
- No under-30-second lesson-generation benchmark has been performed.

For future changes, prefer a separate AskLilOwl adapter outside `vendor/` so the
original snapshots remain easy to compare and update. Review each upstream
README and dependency configuration before running a project independently.

## Verification

Each imported directory's staged Git tree must match its `upstreamTree` in
`sources.json`. A matching tree verifies every tracked file's contents, name,
and executable mode, including the license files. Git history from the upstream
projects is not merged into AskLilOwl's branch history.

After committing, inspect a snapshot tree with:

```bash
git rev-parse HEAD:research/whiteboard/vendor/inkplainer
```

Compare that value with Inkplainer's `upstreamTree`, and repeat for the other
three project directory names. This is an import-integrity check, not a claim
that the projects build, interoperate, or meet the performance target.
