import assert from "node:assert/strict";
import test from "node:test";

import { createLessonAudioService } from "../lesson-audio.js";

test("audio service prepares one narration asset without an image provider", async () => {
  let providerCalls = 0;
  const speechService = {
    enabled: true,
    metadata: () => ({ available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." }),
    generate: async () => {
      providerCalls += 1;
      return { bytes: Buffer.from("audio"), contentType: "audio/mpeg" };
    },
  };
  const service = createLessonAudioService({
    tokenSecret: "s".repeat(32),
    publicOrigin: "https://lesson.example",
    speechService,
  });

  const result = await service.prepare({ narration: "Glass starts as sand.", audience: "general" });

  assert.match(result.audioUrl, /^https:\/\/lesson\.example\/api\/assets\//);
  assert.equal(result.voice.voice, "nova");
  assert.equal(providerCalls, 1);
  assert.equal(service.resolve(result.audioUrl.split("/").pop()).contentType, "audio/mpeg");
});
