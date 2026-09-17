# AskLilOwl — ChatGPT Plugin

AskLilOwl turns a question into an interactive visual lesson inside ChatGPT. This repository contains only the MCP server and embedded lesson widget; the existing standalone application is intentionally untouched.

## How the production flow works

1. The user enables AskLilOwl in ChatGPT and asks a question normally.
2. The active ChatGPT model researches when needed, writes an audience-appropriate lesson, chooses its length, and describes the clearest teaching visual for each slide.
3. ChatGPT calls `create_lesson` with the completed lesson, quiz, sources, and slide-specific image prompts.
4. AskLilOwl finds commercially reusable educational visuals from Wikimedia Commons, validates and securely proxies every raster image, creates one narration track, and renders the complete lesson atomically.

AskLilOwl does **not** select a ChatGPT model. It uses whichever model ChatGPT is currently running or routes to for the conversation. There is also no AskLilOwl `Thinking` mode setting: reasoning controls belong to the ChatGPT host, when the host exposes them, and should not be duplicated in this plugin.

The host ChatGPT model writes the lesson and a concrete `imagePrompt` for each slide. AskLilOwl uses the official Wikimedia Commons API—never arbitrary webpage scraping—to choose a directly relevant Public Domain, CC0, CC BY, or CC BY-SA visual. SVG originals are converted through Wikimedia's official PNG preview and SVG bytes are never delivered to the widget. AskLilOwl securely proxies all raster images before sending the combined visible slide text once to OpenAI's Speech API. The widget plays one AI-generated `nova` voice track at 0.9× while it advances through slide-level cues after the learner presses Start lesson. API credentials remain server-side; AskLilOwl does not call a paid image-generation API, images and quiz answers are not sent for narration, and generated media is retained only in short-lived server memory.

## User experience

The user does not need to configure a model inside AskLilOwl. The widget communicates only states that are useful to the learner:

- a lesson-preparation state while ChatGPT is working;
- lesson objectives and optional source links;
- a compact image-credits section with creator, license, and source links;
- an explicit badge when fixed Inspector demo content is shown;
- a clear error instead of a blank panel when a payload is invalid;
- the disclosure “AI-generated lesson. Verify important information.”

## MCP tools

### `create_lesson`

The production tool receives a finished lesson with 3–20 slides, an audience level, learning objectives, a quiz, optional source links, and exactly one native ChatGPT-generated image file per slide.

ChatGPT owns image generation. The required top-level `images` array uses the file contract verified in Test 24: `file_id` and `download_url` are required strings; `mime_type` and `file_name` are declared optional strings. The tool advertises `openai/fileParams: ["images"]` so the host can rewrite actual generated file paths into downloadable file objects. URL-only objects, file-ID-only objects, bare strings, extra fields, and inline data URIs are rejected at the MCP boundary. Shape rejections occur before handler diagnostics; accepted calls retain safe field/type/origin logs.

AskLilOwl downloads the supplied native images through the existing HTTPS, public-IP, redirect, size, timeout, and raster-signature checks. It temporarily caches them under unique IDs and serves them from its own origin. Public-image discovery and replacements are not used by production. Legacy public-image helpers and their tests remain for history; they are not wired into the lesson flow.

Image count, quiz, and narration limits are checked before downloads; all images must download before the single narration request. Any required image failure keeps the lesson unavailable, including browser-side load failure. No image-generation API is called. Voice remains the existing API-backed narration.

The current cache has a 15-minute TTL, a 32 MiB cache budget, a 5 MiB limit per image, and a 20 MiB limit per lesson. No image recompression is added in this change. Test 24 proved one generated file transfer; automatic question-to-multiple-image orchestration and concurrent-user access isolation still require live validation.

Lesson length is dynamic: use only the slides needed to explain the question clearly, within the existing 3–20 limit.

### `preview_demo_lesson`

A test-only tool registered only when `ASKLILOWL_DEMO_MODE=true`. It provides these fixed MCP Inspector fixtures:

- `birds-young-learner`
- `photosynthesis-middle-school`
- `database-indexes-adult`
- `current-topic-workflow`

The current-topic fixture explains the research workflow; it does not pretend that Inspector performed live research. In normal production mode, this tool is absent and `/test-bird.svg` returns 404.

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm test
npm run test:evals
npm run test:package
npm start
```

The Streamable HTTP endpoint is `http://localhost:8787/mcp`. `/healthz` is the machine-readable health endpoint; `/about`, `/privacy`, `/terms`, and `/support` provide public product information.

### One-click Inspector demos

Start the server with demo mode explicitly enabled.

PowerShell:

```powershell
$env:ASKLILOWL_DEMO_MODE="true"
$env:PUBLIC_ORIGIN="http://localhost:8787"
npm start
```

macOS/Linux:

```bash
ASKLILOWL_DEMO_MODE=true PUBLIC_ORIGIN=http://localhost:8787 npm start
```

Then launch MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Choose **Streamable HTTP**, connect to `http://localhost:8787/mcp`, select `preview_demo_lesson`, choose a fixture, and run it. Inspector supplies the fixed fixture; it does not invoke ChatGPT to write or research the lesson.

## Test the real ChatGPT behavior

1. Deploy the server at a stable public HTTPS endpoint.
2. Leave `ASKLILOWL_DEMO_MODE` unset in production.
3. Enable ChatGPT Developer Mode and add the deployed `/mcp` endpoint.
4. Start a conversation with AskLilOwl enabled and ask for a lesson.
5. Verify that ChatGPT creates the content, uses research for time-sensitive claims, supplies concrete image prompts, and opens the complete widget.
6. Test simple, current, and technical questions plus invalid payload and unavailable-image cases.

## Deployment

`render.yaml` defines the Render web service with `/healthz` as its health check. Configure `PUBLIC_ORIGIN` to the service's public HTTPS origin if it differs from the default, and set `OPENAI_API_KEY` and `VOICE_TOKEN_SECRET` for narration. No image-provider API key is needed. Public-image search settings are inactive. Do not set `ASKLILOWL_DEMO_MODE` in production.

## Plugin package

- `plugin.json` is the portable Agent Plugins manifest.
- `mcp.json` declares the portable Streamable HTTP server.
- `.codex-plugin/plugin.json` and `.mcp.json` provide the supported compatibility layout.
- `assets/` contains the app icon and logo.
- `evals/cases.json` contains versioned tool-selection and product-quality cases.
- `submission/` contains listing copy, review cases, and the live-test record.

The package intentionally has no bundled model setting or `Thinking` control. The active ChatGPT conversation owns model routing, research, writing, and native image generation; AskLilOwl downloads, validates, and temporarily caches those files.

## Limits and operational safeguards

The lesson contract sets explicit limits on text, slides, quiz questions, sources, and image descriptors. The server rejects declared MCP bodies over 2 MiB, validates HTTP(S) source links, applies conservative per-address rate limiting, emits secure HTTP headers, and declares the structured output schema used by the widget.

The widget uses system typography, AA-oriented contrast, visible keyboard focus, semantic progress state, responsive layouts, dark mode, reduced-motion support, and session-only progress restoration. Educational visuals use a fixed responsive frame with `object-fit: contain`, so the complete diagram or photograph remains visible without destructive cropping. It stores no lesson content in an application database.

## Security

Never commit API keys, database passwords, OAuth secrets, or signed temporary file URLs to this repository.
