# Native routing diagnostics — September 17, 2026

These checks distinguish image generation, file transfer, and a complete lesson.
A diagnostic success is not an end-to-end product pass.

## Test 26 — explicit image request generates natively in Chat

- Same chat as failed Test 25:
  https://chatgpt.com/c/6aac4280-ca50-83ea-bd50-09c1abcf7c32
- Follow-up explicitly requested one native arch-bridge educational image, image
  only, without a lesson or narration. No Create image menu selection was used.
- The response generated an image titled `How Arch Bridges Carry Loads`.
- This disproves the hypothesis that manually selecting Create image is required
  in this conversation. It does not prove ordinary-question orchestration works.
- No handoff or complete lesson attempted in this diagnostic.
- API balance: $2.50 before / $2.50 after; no image API or narration request.

## Test 27 — preparation instructions do not activate generation in Chat

- Build: `18d7a84`, deployed and plugin refreshed.
- Fresh AskLilOwl chat; only `How do bridges stay up?` was entered.
- Chat: https://chatgpt.com/c/6aac4462-246c-83ea-a4d6-b79077f70323
- Expanded tool-call UI confirms `prepare_lesson` received the question and
  returned the workflow with `ready: false` and native-generation instructions.
- ChatGPT then reported native generation unavailable as a callable tool. It did
  not generate images or call `create_lesson`. No complete lesson resulted.
- Failed product test. The extra preparation tool alone did not solve routing.
- API balance: $2.50 before / $2.50 after; no image API or narration request.

## Test 28 — native handoff passes in Work; playback/layout defects found

- Same build, fresh AskLilOwl entry, default Work surface and GPT-5.6 Sol Light.
- Only `How do bridges stay up?` entered; no image-specific user instruction.
- Chat: https://chatgpt.com/c/6aac4539-294c-83e9-9ad5-c4202e9eb132
- Native image generation started from the plain question and continued to the
  lesson tool without any corrective user prompt. Final lesson had three slides.
- Render instance `m2g22`, 03:56:19 PM displayed log time: three file references,
  each `referenceKind: both`, from `https://sdmntprcentralus.oaiusercontent.com`.
- Widget rendered the generated images, lesson bodies, narration controls, and
  quiz navigation. Start lesson played narration and automatically advanced slides.
- This proves native generation + multiple-file handoff into the production
  lesson in Work, not automatic activation in Chat. Developer CSP was off, so
  this is not a production-CSP acceptance test.
- Two actual widget/HTTP defects prevent a full quality pass: square image element
  measured 587x587 inside a 587x330 frame (clipped); browser audio duration was
  36.432 seconds but seekable range was only [0,0], causing slide navigation reset.
- User approved both fixes. Offline range test failed before implementation,
  passed after. Real-browser raster fixture failed at 798x798 in 798x449, then
  passed at 798x449 in 798x449. Local silent WAV through the real audio route
  reported [0,10] seekable; paused slide 3 remained at its 4-second cue.
- API balance: **$2.50 before / $2.49 after**, displayed decrement **$0.01**.
  This is a rounded, potentially delayed billing delta, not precise per-request
  attribution. No image API calls. Narration used the existing single-track path.
  A transient billing permissions error cleared on one reload.
- Overall result: native handoff diagnostic passes; full product quality not yet
  passed. Follow-up live verification of the fixes is still required.
