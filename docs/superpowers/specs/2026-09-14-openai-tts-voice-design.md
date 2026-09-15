# AskLilOwl OpenAI TTS Voice Design

## Status

Approved direction: use the existing prepaid OpenAI API account for production narration while preserving the current ChatGPT-authored lesson and native-image workflow.

## Goal

Add secure, high-quality, synchronized server-generated narration to AskLilOwl lessons without exposing an API key, delaying lesson rendering, or making the lesson unusable when speech generation fails.

## Non-goals

- AskLilOwl will not select or call a language model to write lessons.
- AskLilOwl will not generate lesson images through the API.
- The browser will not synthesize speech locally.
- Kokoro or another self-hosted TTS runtime will not be deployed in this phase.
- The first release will not provide user-selectable voices or custom voice cloning.

## Selected approach

The existing `create_lesson` MCP tool continues to validate and return the lesson immediately. During lesson construction, the server creates one signed, expiring speech URL for each slide. The widget renders the text and images without waiting for speech generation. After one user gesture on a **Start lesson** control, a standard HTML audio player requests the first signed URL, and the AskLilOwl server streams the corresponding OpenAI Speech API response to the player.

The default provider settings are:

- model: `gpt-4o-mini-tts`
- voice: `marin`
- response format: MP3
- narration style: warm, clear, encouraging educational narration with age-appropriate pacing and careful pronunciation

`marin` is selected because OpenAI recommends it as one of the highest-quality built-in voices. The deployment can override the model, voice, and style through server-side environment variables without exposing those settings in the lesson tool contract.

## Alternatives considered

### Generate every slide before returning `create_lesson`

This would make the widget payload self-contained, but it would delay the complete lesson until every audio request finishes, increase MCP response size, and make a voice-provider failure block the visual lesson. It is rejected.

### Call OpenAI directly from the widget

This would reduce proxy code, but it would expose a reusable API credential to the client. It is rejected.

### Add a second MCP tool for speech

This would preserve MCP-only communication, but it would require additional host tool calls and would not provide a straightforward streaming URL to a standard audio element. It is rejected for the first release.

## Components

### Speech configuration

A focused speech module owns configuration, token signing and verification, OpenAI request construction, provider error normalization, and stream forwarding. It reads:

- `OPENAI_API_KEY`: required to enable production narration
- `OPENAI_TTS_MODEL`: optional, defaults to `gpt-4o-mini-tts`
- `OPENAI_TTS_VOICE`: optional, defaults to `marin`
- `OPENAI_TTS_INSTRUCTIONS`: optional, defaults to the educational narration style above
- `VOICE_TOKEN_SECRET`: required to issue and accept speech URLs
- `VOICE_TOKEN_TTL_SECONDS`: optional, defaults to 86,400 seconds

No secret is returned through MCP structured content, HTML, logs, or HTTP errors.

### Lesson contract

Each input slide may include an optional `narration` string of at most 2,000 characters. The MCP tool description tells the host model to write concise narration that explains the visible slide accurately and uses vocabulary appropriate to the requested audience.

If `narration` is absent, AskLilOwl derives it from the slide title, body, and optional fun fact. The normalized output slide includes the final narration transcript and an `audioUrl` value when voice is configured. When voice configuration is unavailable, `audioUrl` is `null` and the lesson remains valid.

The lesson output also includes a `voice` object:

- `available`: whether signed speech URLs were issued
- `provider`: `openai` when enabled, otherwise `null`
- `model`: configured model when enabled, otherwise `null`
- `voice`: configured voice when enabled, otherwise `null`
- `disclosure`: `AI-generated voice.` when enabled, otherwise an empty string

Demo fixtures remain usable without an API key. Demo mode does not call OpenAI unless voice configuration is explicitly supplied to the local server.

### Signed speech authorization

Each audio URL contains a compact, URL-safe token carrying only the data needed to generate one slide narration:

- token version
- expiry timestamp
- narration text
- audience
- configured model, voice, instructions, and format

The payload is compressed, base64url encoded, and authenticated with HMAC-SHA256 using `VOICE_TOKEN_SECRET`. The speech endpoint rejects malformed, altered, unsupported, or expired tokens before contacting OpenAI. It does not accept arbitrary narration text outside a valid token.

The token authorizes only the exact narration and provider settings it contains. It is safe to expose to the widget but should still be treated as an expiring bearer capability. HTTP referrer policy remains `no-referrer`.

### Speech endpoint

`GET /api/speech/:token` performs these steps:

1. Apply the existing security headers and a speech-specific per-address rate limit.
2. Verify the token and its expiration.
3. Confirm that `OPENAI_API_KEY` is configured.
4. Request the OpenAI `/v1/audio/speech` endpoint with the authorized model, voice, narration, instructions, and MP3 output.
5. On success, forward the provider content type and stream bytes to the client without first buffering the full audio file.
6. Cancel the upstream request if the client disconnects.
7. Return a short, non-sensitive error response for invalid authorization, provider rate limits, depleted credits, timeouts, or provider failures.

`HEAD /api/speech/:token` verifies the token and reports availability without contacting OpenAI. All other methods return 405.

Successful responses use private browser caching. The server also streams each upstream response while accumulating at most 4 MiB for a bounded 32 MiB in-memory least-recently-used cache keyed by token digest. A repeated request for the same token on the same running instance is served from that cache without another paid API call. Concurrent duplicate requests for a token already being generated receive 409 and a short retry delay instead of starting duplicate provider calls. The server does not retain generated audio or lesson text in a database, and a restart clears the cache.

The speech endpoint allows only `GET` and `HEAD`. It never reflects provider response bodies or the API key to the caller. Logs contain request outcomes, latency, and a non-reversible token digest, not narration text or signed URLs.

## Widget experience

The lesson, current image, heading, body, progress, and voice controls appear together as soon as the MCP result arrives.

The voice controls contain:

- **Start lesson** before playback begins
- pause/resume after playback starts
- replay for the current slide
- mute/unmute
- a concise loading status while the first audio bytes are pending
- the visible disclosure `AI-generated voice.`

The single Start lesson action satisfies browser autoplay restrictions. When narration finishes, the widget advances to the next slide and starts its narration. Manual next, previous, or dot navigation stops the old slide audio and starts the selected slide if narrated mode is active. Entering the quiz stops narration. Reviewing the lesson returns to the first slide with playback paused.

The visible narration transcript is the slide narration text. Screen-reader labels describe playback state, status changes use a polite live region, all controls are keyboard accessible, and reduced-motion preferences continue to be respected.

The widget requests audio only after Start lesson or an explicit replay. It does not preload every slide, which avoids charging for narration the learner never hears.

## Failure behavior

Voice is an enhancement, never a prerequisite for the lesson:

- Missing server configuration produces a normal lesson with disabled voice controls.
- An expired URL changes the control to `Voice session expired` and leaves navigation usable.
- A provider timeout, rate limit, depleted prepaid balance, or server error changes the control to `Voice temporarily unavailable` and leaves text, images, quiz, and sources usable.
- A failed slide does not automatically retry and create an uncontrolled duplicate charge. The learner may explicitly choose **Try voice again** once.
- Navigation or a closed widget aborts in-flight playback and upstream generation where possible.

## Cost controls

- Narration is capped at 2,000 characters per slide and 20 slides per lesson.
- Only signed lesson narration can reach the paid provider.
- A dedicated limiter allows at most 60 speech requests per address in a fixed 10-minute window, independently of MCP traffic.
- Audio is requested on demand rather than pre-generated for unopened slides.
- Browser and bounded server caching prevent normal replays from generating duplicate API calls.
- Provider usage and failures are observable without logging lesson content.
- The OpenAI project should have a spend limit or prepaid balance appropriate to the launch budget.

## Privacy and disclosure

The privacy page and README will state that narration text is sent to OpenAI to generate speech, that AskLilOwl does not send images or quiz answers for this purpose, and that generated audio is streamed back without application-database retention. The widget will disclose that the voice is AI-generated, as required by OpenAI's TTS usage guidance.

## Security

- API keys and signing secrets exist only in server environment variables.
- `.env` files remain ignored and `.env.example` contains names but no secret values.
- Signed URLs expire and are bound to exact narration and provider settings.
- Narration size, token decompression size, HTTP methods, and request rates are bounded.
- Token verification uses constant-time signature comparison.
- Provider errors are normalized before being returned.
- The widget CSP permits connections only to the configured AskLilOwl public origin; it does not connect directly to OpenAI.

## Testing

Tests use a controlled local speech provider or injected fetch implementation and never consume prepaid API credit.

Automated coverage will verify:

- narration validation and fallback derivation
- voice metadata and signed URL creation in normalized lessons
- valid, altered, expired, oversized, and unsupported speech tokens
- exact OpenAI request shape without exposing the API key
- byte streaming, content type, caching headers, disconnect handling, and normalized provider errors
- bounded audio caching and concurrent duplicate suppression
- speech-specific rate limiting
- disabled voice behavior without secrets
- Start, pause, resume, replay, mute, automatic slide advancement, manual navigation, quiz transitions, accessibility labels, and voice failure fallback
- updated package, evaluation, privacy, CSP, and deployment configuration assertions

After automated tests pass, one explicitly approved live smoke test will generate a short sentence with the prepaid API account, confirm audio validity and latency, and record the measured cost/usage. No broad load test will use paid speech without separate approval.

## Deployment and rollout

1. Merge and deploy code with voice disabled when secrets are absent.
2. Add `OPENAI_API_KEY` and a newly generated `VOICE_TOKEN_SECRET` to Render as secret environment variables.
3. Deploy with the default model and voice.
4. Run health, MCP, widget, and short paid speech smoke tests.
5. Verify privacy, disclosure, error fallback, and mobile behavior in the real ChatGPT host.
6. Enable the published plugin only after the smoke test meets the acceptance criteria.

No key or secret will be entered into the repository, terminal output, test fixture, or user-visible configuration.

## Acceptance criteria

- The visual lesson renders without waiting for speech generation.
- One Start lesson action begins server-generated narration and no browser speech synthesis API is used.
- The API key is absent from MCP output, widget source, URLs, logs, and client requests.
- Audio streams through AskLilOwl and remains synchronized with slide navigation.
- The first audible response begins within five seconds in the live warm-service smoke test; the measured value is recorded.
- Provider failure, exhausted credit, or missing configuration never breaks the lesson.
- Normal replay in one widget session does not create another provider call.
- The widget clearly discloses that narration is AI-generated.
- All automated tests, evaluation validation, and package validation pass without making paid API calls.
