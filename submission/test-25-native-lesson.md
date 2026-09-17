# Test 25 — failed before image generation

- Date: 2026-09-17.
- Build: `32b6537`, native-image-only lesson contract deployed and refreshed.
- Entry: AskLilOwl → Try in chat → Chat mode.
- Only question entered: `How do bridges stay up?`
- Chat: https://chatgpt.com/c/6aac4280-ca50-83ea-bd50-09c1abcf7c32
- Result: ChatGPT reported native image generation unavailable in this conversation
  and did not call create_lesson. No complete lesson, audio, images, or quiz rendered.
- Render logs refreshed after response: deployed instance `hgpcb` showed startup
  and no new lesson handoff event. This agrees with the visible chat response.
- No manual Create image selection or corrective follow-up was used, preserving
  the ordinary-question acceptance test.
- Prepaid API balance: **$2.50 before / $2.50 after**. No narration request and
  no image API call; test API spend **$0**. Billing display can lag other activity.
- Conclusion: Test 24's explicitly activated native generation and file transfer
  remain valid. Automatic activation/orchestration from a plain question is not
  working in this tested surface. Production readiness is not established.
