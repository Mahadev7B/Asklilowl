import assert from "node:assert/strict";
import test from "node:test";

import { createSpeechService } from "../speech.js";

test("speech provider request uses Nova at a gentle pace and no client credential", async () => {
  let captured;
  const service = createSpeechService({
    apiKey: "secret-key",
    tokenSecret: "c".repeat(32),
    publicOrigin: "https://lesson.example",
    voice: "nova",
    speed: 0.9,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    },
  });
  const result = await service.generate({ narration: "Leaves capture sunlight.", audience: "middle school" });
  assert.deepEqual([...result.bytes], [0x49, 0x44, 0x33, 1]);
  assert.equal(captured.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(captured.options.headers.Authorization, "Bearer secret-key");
  assert.deepEqual(JSON.parse(captured.options.body), {
    model: "gpt-4o-mini-tts",
    voice: "nova",
    input: "Leaves capture sunlight.",
    instructions: "Speak like a friendly, playful, reassuring teacher for children. Sound natural and conversational, with gentle enthusiasm and a little sense of wonder. Use a warm, welcoming tone and relaxed pacing. Add brief natural pauses after discoveries. Never sound formal, stern, rushed, dramatic, or like an announcer. Pronounce educational words clearly without overemphasis.",
    response_format: "mp3",
    speed: 0.9,
  });
});

test("speech service reports a sanitized voice-provider failure", async () => {
  const service = createSpeechService({
    apiKey: "test-key",
    tokenSecret: "d".repeat(32),
    publicOrigin: "https://lesson.example",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "insufficient_quota", message: "You exceeded your current quota." },
    }), { status: 429 }),
  });

  await assert.rejects(
    () => service.generate({ narration: "Leaves capture sunlight.", audience: "middle school" }),
    (error) => {
      assert.equal(error.provider, "voice");
      assert.equal(error.status, 429);
      assert.equal(error.code, "insufficient_quota");
      assert.equal(error.message, "Voice quota unavailable");
      return true;
    }
  );
});
