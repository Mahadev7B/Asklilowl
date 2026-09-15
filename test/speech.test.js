import assert from "node:assert/strict";
import test from "node:test";

import { createSpeechService } from "../speech.js";

test("speech service signs exact narration and rejects altered tokens", () => {
  const service = createSpeechService({
    apiKey: "test-key",
    tokenSecret: "a".repeat(32),
    publicOrigin: "https://lesson.example",
    now: () => 1_000,
  });
  const url = new URL(service.createAudioUrl({ narration: "Plants turn light into stored energy.", audience: "middle school" }));
  assert.equal(url.origin, "https://lesson.example");
  const token = url.pathname.split("/").pop();
  assert.equal(service.verifyToken(token).narration, "Plants turn light into stored energy.");
  const alteredToken = `${token[0] === "x" ? "y" : "x"}${token.slice(1)}`;
  assert.throws(() => service.verifyToken(alteredToken), /Invalid voice token/);
});

test("speech service rejects expired tokens", () => {
  let now = 1_000;
  const service = createSpeechService({ apiKey: "test-key", tokenSecret: "b".repeat(32), publicOrigin: "https://lesson.example", now: () => now, tokenTtlSeconds: 1 });
  const token = new URL(service.createAudioUrl({ narration: "Hello", audience: "adult" })).pathname.split("/").pop();
  now = 2_001;
  assert.throws(() => service.verifyToken(token), /expired/);
});

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
