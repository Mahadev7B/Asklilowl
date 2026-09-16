# ChatGPT-Owned Images Design

## Goal

Restore AskLilOwl's intended production contract: ChatGPT produces the lesson, quiz, and slide images; Render generates only the single Nova narration track and returns an interactive lesson only when every required asset is ready.

## Ownership and data flow

1. A learner asks a natural educational question in an AskLilOwl-attached ChatGPT conversation.
2. ChatGPT infers an appropriate audience, researches when needed, creates the lesson and quiz, and generates one simple native ChatGPT image per slide.
3. ChatGPT calls `create_lesson` with the lesson payload and one ChatGPT-managed image file object for each slide.
4. Render validates the complete payload, makes exactly one OpenAI Speech API request for the combined visible slide text, then returns the lesson widget.
5. If an image is missing or narration cannot be generated, Render returns the existing generic retry response and no partial lesson.

## Constraints

- Render must never call the OpenAI Images API in the production lesson path.
- The only paid API request owned by Render is the single OpenAI Speech API request per accepted lesson.
- The tool instructions must tell ChatGPT to use native image generation and attach the resulting managed file objects; users must not need to request a lesson, audience, quiz, or images explicitly.
- Every returned production lesson has exactly one image per slide and one audio track.
- Operational logs may contain only a voice-provider name, HTTP status, bounded provider error code, and generic message. They must never contain API keys, prompts, lesson text, image URLs, image bytes, or audio tokens.

## Components

- `server.js` owns the host-facing tool instructions and atomic handler. It validates image completeness before requesting speech and logs voice-provider failures safely.
- `lesson.js` and `lesson-schema.js` retain the ChatGPT-managed image-file contract and verify slide-to-image coverage.
- `speech.js` remains the sole OpenAI API client in the production lesson path.
- `lesson-assets.js` is removed because it implements the prohibited server-side image API path.
- Tests prove that images are supplied by ChatGPT, speech is called once only after valid image coverage, and image API configuration is absent from the production code path.

## Failure behavior

Missing, invalid, or incomplete ChatGPT-managed image files prevent narration generation and produce the normal retry result. A speech provider failure also produces the normal retry result and a sanitized voice diagnostic. The widget never renders a partial lesson.
