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

## Test 16 — failed

- Question: `How do bridges stay up?`
- Build: `c6238ca` (`Recover from temporary public image rate limits`).
- Result: two concurrent Wikimedia Commons search streams received HTTP 429 and retried in lockstep; both exhausted the bounded retries, so the complete lesson was withheld atomically.
- Voice cost: no narration request was made because image preparation did not complete.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: serialize public-image discovery to one search stream while retaining bounded 429 retry/backoff before Test 17.

## Test 17 — failed

- Question: `How do bridges stay up?`
- Build: `0b7571f` (`Serialize public image discovery`).
- Result: ChatGPT answered directly in the existing failure-heavy conversation and did not invoke AskLilOwl; Render received no lesson request.
- Voice cost: no narration request was made.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: start the next test from AskLilOwl's own **Try in chat** entry point with Chat mode selected and submit only the ordinary question.

## Test 18 — failed

- Question: `How do bridges stay up?`
- Build: `0b7571f` (`Serialize public image discovery`).
- Entry path: AskLilOwl plugin page → **Try in chat** → **Chat** mode; the user question did not contain a manual app tag.
- Result: AskLilOwl was invoked and serialized search eliminated HTTP 429 errors. Three slide searches selected licensed relevant images, but one slide exhausted its specific queries without a relevant candidate, so the complete lesson was withheld atomically.
- Voice cost: no narration request was made because image preparation did not complete.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: retry a missing slide-specific visual with a broader lesson-topic request under the same license, relevance, raster, and security rules before Test 19.

## Test 19 — failed

- Question: `How do bridges stay up?`
- Build: `ab6723b` (`Use topic visual when slide image is unavailable`).
- Entry path: AskLilOwl plugin page → **Try in chat** → **Chat** mode; the user question did not contain a manual app tag.
- Result: AskLilOwl was invoked. Two sequential Wikimedia searches succeeded, then the third received HTTP 429 and exhausted two fixed two-second retries before the broader topic fallback could run.
- Voice cost: no narration request was made because image preparation did not complete.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: pace all Wikimedia API calls and use bounded exponential retry delays before Test 20.

## Test 20 — failed

- Question: `How do bridges stay up?`
- Build: `03fc21c` (`Pace public image searches`).
- Entry path: AskLilOwl plugin page → **Try in chat** → **Chat** mode; the user question did not contain a manual app tag.
- Result: AskLilOwl was invoked and paced image search progressed beyond the prior rate-limit failure. A selected Wikimedia image then carried an `ImageDescription` longer than the plugin's 600-character metadata limit. ChatGPT retried once with simpler slide prompts, but the same unbounded third-party metadata caused the lesson to be withheld atomically.
- Voice cost: no narration request was made because strict image metadata validation failed before TTS.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: clean and bound Wikimedia metadata to the existing lesson schema before Test 21.

## Test 21 — failed

- Question: `How do bridges stay up?`
- Build: `9ffed4e` (`Bound public image metadata`).
- Entry path: AskLilOwl plugin page → **Try in chat** → **Chat** mode; the user question did not contain a manual app tag.
- Result: the metadata validation failure from Test 20 was fixed and several licensed image searches succeeded. A later Wikimedia Commons lookup remained HTTP 429 after three bounded eight-second waits, so the complete lesson was withheld atomically.
- Voice cost: no narration request was made because image preparation did not complete.
- API credit balance: `$2.51` before and `$2.51` after the test.
- Follow-up: after at least one licensed visual has been verified, reuse that visual for remaining slides when Wikimedia rate-limits the lesson; preserve atomic failure when no verified visual exists.
