# AskLilOwl — ChatGPT Plugin Prototype

This repository is the plugin-only version of AskLilOwl. The existing production app is intentionally left untouched.

## Goal

Turn any question into an interactive visual lesson inside ChatGPT while avoiding separate per-lesson AI provider costs.

Target flow:

1. The user asks AskLilOwl to explain a topic.
2. ChatGPT creates the lesson content itself.
3. ChatGPT chooses a dynamic slide count based on topic complexity and requested depth.
4. ChatGPT generates lesson images with its native image-generation capability when available.
5. ChatGPT calls the `create_lesson` MCP tool with the lesson, quiz, and image files.
6. AskLilOwl renders the lesson in its own interactive widget.

There are no Anthropic, Fal.ai, or OpenAI API calls in this prototype.

## Dynamic lesson length

AskLilOwl does not force four slides.

- Quick/simple: typically 4–5 slides
- Standard/moderate: typically 6–8 slides
- Complex: typically 9–12 slides
- Deep dive: up to 20 slides

The model should use the minimum number of slides needed to explain the topic clearly.

## Current prototype

The initial MCP server exposes:

- `create_lesson` — receives a completed lesson, quiz, and optional ChatGPT-managed image files and renders them in the AskLilOwl widget.
- `/mcp` — Streamable HTTP MCP endpoint for ChatGPT/Inspector.
- `/` — health endpoint only. This repository is not intended to expose a standalone lesson website.

Image handoff is declared with `_meta["openai/fileParams"]` so we can validate the important path: ChatGPT-generated image → MCP tool → AskLilOwl widget.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

The MCP endpoint will be available at:

```text
http://localhost:8787/mcp
```

Test it with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Choose **Streamable HTTP** and connect to `http://localhost:8787/mcp`.

## Deployment

A `render.yaml` is included so this can later be deployed as a separate Render service. No AI-provider secret is required for the prototype.

## Next milestones

1. Prove text lesson → dynamic slides → widget.
2. Prove ChatGPT-generated image → `openai/fileParams` → widget.
3. Refine the widget to match the existing AskLilOwl experience.
4. Add narration strategy.
5. Add parent/teacher account and saved lesson history only after the core plugin flow works.
6. Test privately in ChatGPT Developer Mode before any submission.

## Security note

Never commit API keys, database passwords, OAuth secrets, or signed temporary file URLs to this repository.

## Animation research

The [whiteboard research collection](research/whiteboard/README.md) contains pinned
source snapshots of Inkplainer, Excalimate, ExcaliMath, and Ray Optics, with licenses,
upstream versions, and a reuse index. These are research materials only and are not
connected to the app runtime.
