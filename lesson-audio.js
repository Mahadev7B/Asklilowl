import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export function createLessonAudioService({
  tokenSecret = process.env.VOICE_TOKEN_SECRET,
  publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com",
  assetTtlSeconds = Number(process.env.LESSON_AUDIO_TTL_SECONDS ?? 900),
  speechService,
  now = Date.now,
} = {}) {
  const enabled = Boolean(tokenSecret && tokenSecret.length >= 32 && speechService?.enabled);
  const assets = new Map();
  const origin = publicOrigin.replace(/\/+$/, "");
  const sign = (id, expiresAt) => createHmac("sha256", tokenSecret).update(`${id}.${expiresAt}`).digest("base64url");
  const assetUrl = (id, expiresAt) => `${origin}/api/assets/${id}.${expiresAt}.${sign(id, expiresAt)}`;

  function put(bytes, contentType, name) {
    if (!bytes?.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Generated lesson audio is invalid.");
    const id = randomUUID();
    const expiresAt = now() + assetTtlSeconds * 1_000;
    const asset = { bytes, contentType, name, expiresAt };
    assets.set(id, asset);
    while (assets.size > 64) assets.delete(assets.keys().next().value);
    return { ...asset, url: assetUrl(id, expiresAt) };
  }

  async function prepare({ narration, audience }) {
    if (!enabled) throw new Error("Lesson voice is temporarily unavailable.");
    const audio = await speechService.generate({ narration, audience });
    const asset = put(audio.bytes, audio.contentType, "asklilowl-lesson.mp3");
    return { audioUrl: asset.url, voice: speechService.metadata() };
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
