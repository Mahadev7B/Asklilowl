import assert from "node:assert/strict";
import test from "node:test";

import { createLessonAssetService } from "../lesson-assets.js";

test("asset service prepares every image and one narration asset together", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("images/generations")) return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
    return new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  const speechService = { enabled: true, metadata: () => ({ available: true }), generate: async () => ({ bytes: Buffer.from("audio"), contentType: "audio/mpeg" }) };
  const service = createLessonAssetService({ apiKey: "test", tokenSecret: "s".repeat(32), publicOrigin: "https://lesson.example", fetchImpl, speechService });

  const result = await service.prepare({ slidePrompts: ["sand", "furnace"], narration: "Glass lesson.", audience: "general" });

  assert.equal(result.images.length, 2);
  assert.match(result.images[0].url, /^https:\/\/lesson\.example\/api\/assets\//);
  assert.match(result.audioUrl, /^https:\/\/lesson\.example\/api\/assets\//);
});

test("asset service rejects an incomplete image batch", async () => {
  const speechService = { enabled: true, metadata: () => ({ available: true }), generate: async () => ({ bytes: Buffer.from("audio"), contentType: "audio/mpeg" }) };
  const service = createLessonAssetService({ apiKey: "test", tokenSecret: "s".repeat(32), fetchImpl: async () => new Response("no", { status: 503 }), speechService });

  await assert.rejects(() => service.prepare({ slidePrompts: ["sand"], narration: "Glass lesson.", audience: "general" }), /Image provider unavailable/);
});

test("asset service reports a sanitized image-provider failure", async () => {
  const speechService = { enabled: true, metadata: () => ({ available: true }), generate: async () => ({ bytes: Buffer.from("audio"), contentType: "audio/mpeg" }) };
  const service = createLessonAssetService({
    apiKey: "test",
    tokenSecret: "s".repeat(32),
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "image_model_access_denied", message: "Access to this image model is not enabled." } }), { status: 403 }),
    speechService,
  });

  await assert.rejects(
    () => service.prepare({ slidePrompts: ["sand"], narration: "Glass lesson.", audience: "general" }),
    (error) => {
      assert.equal(error.provider, "image");
      assert.equal(error.status, 403);
      assert.equal(error.code, "image_model_access_denied");
      assert.equal(error.message, "Image provider unavailable");
      return true;
    }
  );
});
