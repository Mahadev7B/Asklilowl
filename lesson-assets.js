import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export function createLessonAssetService({
  apiKey = process.env.OPENAI_API_KEY,
  tokenSecret = process.env.VOICE_TOKEN_SECRET,
  publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com",
  imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  imageQuality = process.env.OPENAI_IMAGE_QUALITY ?? "medium",
  imageSize = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024",
  assetTtlSeconds = Number(process.env.LESSON_ASSET_TTL_SECONDS ?? 900),
  fetchImpl = fetch,
  speechService,
  now = Date.now,
} = {}) {
  const enabled = Boolean(apiKey && tokenSecret && tokenSecret.length >= 32 && speechService?.enabled);
  const assets = new Map();
  const origin = publicOrigin.replace(/\/+$/, "");
  const sign = (id, expiresAt) => createHmac("sha256", tokenSecret).update(`${id}.${expiresAt}`).digest("base64url");
  const assetUrl = (id, expiresAt) => `${origin}/api/assets/${id}.${expiresAt}.${sign(id, expiresAt)}`;

  function put(bytes, contentType, name) {
    if (!bytes?.length || bytes.length > MAX_ASSET_BYTES) throw new Error("Generated lesson asset is invalid.");
    const id = randomUUID();
    const expiresAt = now() + assetTtlSeconds * 1_000;
    const asset = { bytes, contentType, name, expiresAt };
    assets.set(id, asset);
    while (assets.size > 64) assets.delete(assets.keys().next().value);
    return { ...asset, url: assetUrl(id, expiresAt) };
  }

  async function generateImage(prompt, index) {
    const response = await fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: imageModel, prompt, quality: imageQuality, size: imageSize, response_format: "b64_json" }),
    });
    if (!response.ok) throw new Error("Image provider unavailable");
    const payload = await response.json();
    if (typeof payload?.data?.[0]?.b64_json !== "string") throw new Error("Image provider returned no image.");
    const asset = put(Buffer.from(payload.data[0].b64_json, "base64"), "image/png", `lesson-slide-${index + 1}.png`);
    return { index, fileId: null, url: asset.url, mimeType: asset.contentType, fileName: asset.name, size: asset.bytes.length };
  }

  async function prepare({ slidePrompts, narration, audience }) {
    if (!enabled) throw new Error("Lesson assets are temporarily unavailable.");
    if (!Array.isArray(slidePrompts) || !slidePrompts.length) throw new Error("Lesson needs slide visuals.");
    const [images, audio] = await Promise.all([
      Promise.all(slidePrompts.map(generateImage)),
      speechService.generate({ narration, audience }),
    ]);
    const audioAsset = put(audio.bytes, audio.contentType, "asklilowl-lesson.mp3");
    return { images, audioUrl: audioAsset.url, voice: speechService.metadata() };
  }

  function resolve(token) {
    const [id, rawExpiry, signature, extra] = String(token).split(".");
    const expiresAt = Number(rawExpiry);
    if (!id || !signature || extra || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) return null;
    const expected = Buffer.from(sign(id, expiresAt));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const asset = assets.get(id);
    return asset?.expiresAt === expiresAt ? asset : null;
  }

  return { enabled, prepare, resolve };
}
