# AskLilOwl Launch-Readiness Design

**Date:** 2026-09-13

## Purpose

Turn the current AskLilOwl MCP prototype into a staging-ready ChatGPT app package with a production-safe lesson contract, a guideline-aligned accessible widget, repeatable quality evaluations, public-facing policy/support pages, and a documented path to ChatGPT Developer Mode testing and eventual public submission.

## Approved Product Flow

AskLilOwl does not select a ChatGPT model and does not expose a “Thinking mode” control. The active ChatGPT conversation—using the model or automatic routing available to the user—researches when needed, writes the lesson, optionally generates educational images, and calls `create_lesson`. The MCP server validates and renders that completed lesson. MCP Inspector remains a protocol/UI test harness and receives fixed JSON; its optional demo tool is explicitly test-only.

## Architecture

The Node.js server exposes a stateless Streamable HTTP MCP endpoint at `/mcp`, one production tool (`create_lesson`), and one conditional Inspector-only tool (`preview_demo_lesson`) when `ASKLILOWL_DEMO_MODE=true`. Shared Zod schemas define the accepted lesson input and declared structured output. Pure lesson normalization remains separate from transport code. Static widget and policy pages are served by the same HTTPS origin.

The widget consumes only MCP tool results, renders lesson slides and a quiz, resolves ChatGPT-managed file references where the host API is available, and never calls external AI, image, voice, analytics, or advertising providers. It persists only non-sensitive viewing progress in session storage.

## Product and Safety Requirements

- Production exposes only `create_lesson`; the demo tool and demo image are absent unless demo mode is explicitly enabled.
- Input limits bound text, arrays, URLs, image descriptors, and request size. Source URLs must use HTTP or HTTPS.
- Quiz answer indices are validated against their choices.
- Structured results conform to a declared output schema.
- The HTTP service applies conservative rate limiting, secure response headers, request timeouts, CORS required by MCP clients, and predictable 4xx/5xx errors.
- No user account, long-term lesson storage, advertising, analytics, external model API, or external media provider is added.
- Policy copy accurately describes in-memory processing and ordinary infrastructure logs; it must not make unverifiable legal or privacy promises.

## Widget Experience

The widget uses the host system font, a restrained solid-color visual system, WCAG-AA text/control contrast, visible keyboard focus, semantic progress information, accessible slide navigation controls, live quiz feedback, meaningful image alt text, responsive layout, and text resizing support. It does not repeat the AskLilOwl logo or product name inside the rendered response where ChatGPT already supplies app identity.

The interface communicates three states clearly: ChatGPT is preparing the lesson, a complete interactive lesson is available, or the tool returned an error/incomplete result. A small AI-generated-content disclosure and optional sources section remain visible without implying that AskLilOwl chose the model or performed independent research.

## Quality Evaluation

The repository includes a versioned evaluation set covering at least five successful requests and three requests the tool should not claim to fulfill. Coverage includes young learners, middle-school science, adult technical material, current-information research, deep topics, image-backed lessons, malformed quiz data, unsafe URLs, excessive payloads, model-selection requests, and unsupported external actions.

Automated tests cover schema validation, normalization, output conformance, HTTP limits/headers/routes, production/demo tool exposure, widget behavior, accessibility attributes, and evaluation-file integrity. A manual ChatGPT checklist covers direct, indirect, follow-up, unsupported, UI restoration, console-error, mobile-width, and model-readable-result cases.

## Plugin Package and Submission Materials

The repository includes the portable Agent Plugins `plugin.json` and `mcp.json` manifests plus the `.codex-plugin/plugin.json` compatibility manifest. Metadata describes AskLilOwl as a renderer, points to the deployed MCP endpoint and public policy/support pages, and avoids any claim that the plugin selects a model. Submission documentation contains concise descriptions, starter prompts, category guidance, five positive and three negative test cases, and an evidence checklist.

Final public submission is excluded from unattended automation because it requires the owner’s verified organization identity, review of legal/publisher details, and an action-time confirmation before submitting to OpenAI. The implementation may prepare and validate every preceding field and artifact.

## Deployment

Deployment targets Render using the existing repository configuration and a public HTTPS endpoint. The production environment must not enable demo mode. Health, policy, support, static assets, MCP discovery, valid tool invocation, invalid input handling, and demo isolation are verified against the deployed URL. ChatGPT Developer Mode testing follows only when the user is already signed in and the setting is enabled; authentication and security-setting changes remain user-controlled.

## Success Criteria

All automated checks and dependency audit pass, the repository is committed and pushed to a dedicated feature branch, a public staging endpoint responds correctly, the MCP connection is exercised in ChatGPT Developer Mode when access permits, and any remaining publisher-only or confirmation-gated steps are reported precisely with prepared artifacts ready for completion.
