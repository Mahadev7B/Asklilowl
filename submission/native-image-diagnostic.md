# Native image diagnostic — 2026-09-17

Scope: one natively generated ChatGPT image transferred to AskLilOwl. No
create_lesson, narration, public-image fallback, or image-generation API calls.

Deployed diagnostic: `827365c`, on `codex/launch-readiness`. Release checkout is
isolated from the pending public-image relevance edits in the original checkout.
Offline verification: 97 tests, 17 evaluation cases, package validation passed.
Live MCP tools/list and ChatGPT Refresh both confirmed `probe_native_image`.
Its `image` file input declares all four documented properties, requires only
`download_url` and `file_id`, and has `openai/fileParams: ["image"]`.

Chat: https://chatgpt.com/c/6aac38e5-094c-83e9-895f-66224256fc64

## Test 23 — failed before generation

- Chat surface, AskLilOwl selected, direct request to generate then transfer.
- ChatGPT reported native generation was not exposed and did not invoke probe.
- Render log inspected after the attempt: no probe receipt.
- Prepaid balance before test: $2.50. No API-backed service invoked by diagnostic.
- Next evidence-driven change: explicitly select Create image in the chat menu.

## Test 24 — passed: native file handoff and verified raster download

- Same chat, explicitly selected Create image.
- Requested one purple owl holding a yellow pencil against white.
- Generation completed. A follow-up requested the handoff of that same file.
- Visible tool request: `image: "/mnt/data/cheerful_purple_owl_with_pencil.png"`.
  The model supplied a real file path; ChatGPT transformed it into the declared
  file object before forwarding it to AskLilOwl.
- Render, 15:04:40 America/Indianapolis, instance `9xwzm`, logged:
  `native_image_probe_received`, then `native_image_probe_downloaded`.
- Both events and ChatGPT's result share probe ID
  `3a2048eb-dd31-4e68-9156-3f6c99ba24c5`.
- Received keys/types: `download_url`, `file_id`, `mime_type`, `file_name`, all strings.
- `hasFileId: true`, `hasDownloadUrl: true`.
- Origin: `https://oaisdmntprcentralus.blob.core.windows.net`.
- Downloaded **1,436,761 bytes**, MIME **image/png**, through the existing secure
  image downloader, including raster-signature checks. No public-image sourcing.
- Prepaid API credit balance: **$2.50 before / $2.50 after**. No image or voice
  API request was made. Billing may report other activity with delay.
- This proves native file transfer and server download. It does not yet prove
  automatic single-prompt lesson orchestration or full lesson-widget playback.
- Temporary live tool registration removed after the test. The diagnostic module
  and offline test remain as reproducible development evidence, unregistered.

## Proven mechanism and limits

Use an exact top-level file parameter with both required file fields and the
`openai/fileParams` metadata, refresh the connection, generate the image using
Create image, then pass the generated file path to that parameter. ChatGPT does
the path-to-downloadable-file rewrite. The broad earlier claim that native image
handoff is impossible on this surface is disproved by Test 24.

Test 23's missing generation tool was resolved by explicit Create image selection.
Historical failures cannot all be assigned this same cause without their traces.
Reference: https://developers.openai.com/plugins/reference#define-file-inputs
