# Live ChatGPT test results

**Endpoint:** https://asklilowl-chatgpt.onrender.com/mcp

**Build/commit:** `f99eb491ccee462187fc51327955210237230270` (`codex/launch-readiness`)

**Render deploy:** `dep-dak4e4vf3r2c73c1pksg`

**Test date:** 2026-09-14

## Automated deployed-endpoint verification

- Render reported `Deploy succeeded | Live` for the recorded commit on the existing Free instance.
- `/`, `/healthz`, `/about`, `/privacy`, `/terms`, and `/support` returned HTTP 200.
- Each public route returned the expected `X-Content-Type-Options`, `Referrer-Policy`, and Content Security Policy headers.
- MCP initialization succeeded and the production tool list contained only `create_lesson`, with a declared lesson output schema.
- The lesson UI resource declared its stable production origin in `_meta.ui.domain`, as required for ChatGPT plugin review.
- A valid three-slide lesson returned schema-conformant structured content.
- An invalid quiz `answerIndex` returned an actionable tool error.
- `/test-bird.svg` returned HTTP 404, confirming that the Inspector-only demo asset is not exposed in production.

The service is hosted on Render's Free instance. Render warns that inactive free instances can spin down, delaying a later request by 50 seconds or more.

## ChatGPT Developer Mode results

AskLilOwl is connected to ChatGPT in Developer Mode as app `asdk_app_6aa84ac852348191aa19769cbddf28dd`. ChatGPT discovered one read-only action (`create_lesson`) and the `ui://asklilowl/lesson.html` template. The Inspector-only demo action was not exposed. The lesson cases below still require end-to-end conversation testing after the refreshed metadata is deployed.

| Case | Tool selection | Lesson quality | Widget/UI | Model-readable result | Status |
| --- | --- | --- | --- | --- | --- |
| Young bird flight | Not run | Not run | Not run | Not run | Pending |
| Middle-school photosynthesis | Not run | Not run | Not run | Not run | Pending |
| Adult database indexes | Not run | Not run | Not run | Not run | Pending |
| Current market context | Not run | Not run | Not run | Not run | Pending |
| Water-cycle image | Not run | Not run | Not run | Not run | Pending |
| Model-selection boundary | Not run | Not applicable | Not applicable | Not run | Pending |
| Unsupported external action | Not run | Not applicable | Not applicable | Not run | Pending |
| Unsupported audio | Not run | Not applicable | Not applicable | Not run | Pending |

These cases remain “Not run” until they are observed inside ChatGPT Developer Mode. The successful endpoint/MCP checks above do not count as ChatGPT host-model or rendered-widget passes.

## Test 15 — failed

- Question: `How do bridges stay up?`
- Result: the lesson was withheld atomically because one required Wikimedia Commons search returned HTTP 429 while other slide searches succeeded.
- Voice cost: no narration request was made because image preparation did not complete.
- Follow-up: add bounded 429 retry/backoff and reduce public-image search concurrency before Test 16.
