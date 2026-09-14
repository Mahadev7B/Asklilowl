# AskLilOwl Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tested, accessible, packaged, staging-deployed AskLilOwl ChatGPT app without changing the product rule that the active ChatGPT model creates the lesson and AskLilOwl only validates and renders it.

**Architecture:** Keep lesson construction pure, move all MCP input/output limits into shared Zod schemas, expose a configurable HTTP server for behavioral tests, and keep the Inspector fixture tool behind an environment flag. The self-contained widget receives MCP Apps messages, renders accessible state, and stores only local presentation progress.

**Tech Stack:** Node.js 20, ECMAScript modules, Model Context Protocol SDK, MCP Apps SDK, Zod 3, Node test runner, JSDOM, Render, Agent Plugins manifests.

**Spec:** `docs/superpowers/specs/2026-09-13-asklilowl-launch-readiness-design.md`

## Global Constraints

- Preserve the separation between host-model generation and AskLilOwl rendering.
- Do not add a model picker, “Thinking mode,” external model API, external image provider, TTS provider, analytics, or user storage.
- Keep demo behavior opt-in and absent from production.
- Write a failing behavioral test before each implementation change.
- Use `apply_patch` for source and documentation edits.
- Do not perform final public marketplace submission without the user’s action-time confirmation and verified publisher details.

---

### Task 1: Define a bounded, declared lesson contract

**Files:**

- Create: `lesson-schema.js`
- Modify: `server.js`
- Modify: `lesson.js`
- Create: `test/lesson-schema.test.js`
- Modify: `test/lesson.test.js`

- [x] Add failing tests for text/array bounds, HTTP(S)-only sources, image descriptor bounds, quiz indices, and output conformance.
- [x] Implement reusable input and output Zod schemas with field descriptions.
- [x] Register `outputSchema` for production and demo tools.
- [x] Make `buildLesson` produce only schema-conformant structured output.
- [x] Run the focused schema and lesson tests.

### Task 2: Harden and test the HTTP boundary

**Files:**

- Modify: `server.js`
- Create: `http-security.js`
- Create: `test/http-server.test.js`

- [x] Add failing integration tests for health/policy routes, security headers, request-size rejection, rate limiting, production/demo exposure, and demo asset isolation.
- [x] Export configurable MCP and HTTP server factories while preserving the CLI entry point.
- [x] Add secure headers, a 2 MiB content-length limit, a conservative per-address rate limiter, and server timeout settings.
- [x] Serve privacy, terms, support, and about pages with explicit content types.
- [x] Run the HTTP integration tests and production/demo MCP smoke tests.

### Task 3: Bring the widget to accessible ChatGPT UI standards

**Files:**

- Modify: `public/lesson-widget.html`
- Modify: `test/widget.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Add failing JSDOM behavior tests for tool-result rendering, navigation, quiz feedback, error handling, progress semantics, keyboard focus affordances, duplicate-brand removal, and progress restoration.
- [x] Install JSDOM as a development dependency.
- [x] Replace gradients/custom fonts with system styling and AA-contrast solid colors.
- [x] Remove repeated logo/name chrome, enlarge slide navigation targets, add `aria-current`, live regions, semantic progress state, and visible `:focus-visible` treatment.
- [x] Persist non-sensitive slide/quiz state in session storage and restore it only for the same lesson.
- [x] Run widget tests and visually inspect desktop and narrow layouts.

### Task 4: Add repeatable product-quality evaluations

**Files:**

- Create: `evals/cases.json`
- Create: `evals/README.md`
- Create: `scripts/validate-evals.js`
- Create: `test/evals.test.js`
- Modify: `package.json`

- [x] Add a failing test that requires unique cases, five positive and three negative cases, expected tool decisions, audience coverage, current-information coverage, and unsupported-request coverage.
- [x] Add the evaluation corpus and a validation script.
- [x] Document manual scoring for factual accuracy, pedagogy, image usefulness, quiz validity, UI rendering, follow-ups, and unsupported actions.
- [x] Run the eval validation and full unit suite.

### Task 5: Package the plugin and public materials

**Files:**

- Create: `plugin.json`
- Create: `mcp.json`
- Create: `.codex-plugin/plugin.json`
- Create: `public/about.html`
- Create: `public/privacy.html`
- Create: `public/terms.html`
- Create: `public/support.html`
- Create: `assets/asklilowl-icon.png`
- Create: `assets/asklilowl-logo.png`
- Create: `submission/README.md`
- Create: `submission/test-cases.md`

- [x] Use the plugin scaffold workflow to establish valid compatibility metadata.
- [x] Add failing manifest/package validation tests.
- [x] Add portable and compatibility manifests pointing at the deployed MCP path.
- [x] Create restrained, original brand assets and validate dimensions/format.
- [x] Add truthful public pages and a submission packet with descriptions, prompts, category, support route, and review test cases.
- [x] Validate all manifests and links locally.

### Task 6: Complete local release verification

**Files:**

- Modify: `README.md`
- Modify: `.gitignore`

- [x] Document production configuration, demo isolation, endpoint routes, package structure, eval commands, and Developer Mode testing.
- [x] Run `npm test`, eval validation, syntax checks, `npm audit`, production smoke tests, and demo smoke tests.
- [x] Inspect the final diff for secrets, unrelated changes, hardcoded demo leakage, model-selection claims, and guideline regressions.

### Task 7: Commit and publish the feature branch

**Files:** all launch-readiness changes.

- [x] Commit on `codex/launch-readiness` with a focused message.
- [x] Push the branch to `Mahadev7B/Asklilowl`.
- [x] Record the remote branch and commit SHA for review: `f99eb491ccee462187fc51327955210237230270`.

### Task 8: Deploy and verify staging

**Files:**

- Modify if required: `render.yaml`
- Modify if required: `mcp.json`
- Modify if required: `plugin.json`

- [x] Confirm the intended Render service/domain and ensure demo mode is disabled.
- [x] Deploy the feature branch to the existing authorized non-paid Render service.
- [x] Verify HTTPS health, policy/support pages, MCP initialization, tool listing, valid invocation, invalid input, output schema, CSP, and demo isolation.
- [x] Record the verified public MCP URL and the free-instance cold-start limitation.

### Task 9: Test in ChatGPT Developer Mode and prepare submission handoff

**Files:**

- Create: `submission/live-test-results.md`
- Modify: `submission/README.md`

- [x] Connect the deployed MCP endpoint in the browser when the signed-in account already has Developer Mode enabled.
- [ ] Run representative direct, indirect, follow-up, current-topic, edge, and unsupported requests.
- [ ] Verify the rendered UI, model-readable response, citations/sources, image handling, state restoration, narrow layout, and browser console.
- [ ] Record observed results and unresolved issues without fabricating passes.
- [ ] Stop before any final public submission action and request action-time confirmation plus any missing verified publisher/legal details.
