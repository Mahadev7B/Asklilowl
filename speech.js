import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const DEFAULT_INSTRUCTIONS = "Speak like a friendly, playful, reassuring teacher for children. Sound natural and conversational, with gentle enthusiasm and a little sense of wonder. Use a warm, welcoming tone and relaxed pacing. Add brief natural pauses after discoveries. Never sound formal, stern, rushed, dramatic, or like an announcer. Pronounce educational words clearly without overemphasis.";

const encode = (value) => Buffer.from(value).toString("base64url");
const decode = (value) => Buffer.from(value, "base64url");

export function createSpeechService({
  apiKey = process.env.OPENAI_API_KEY,
  tokenSecret = process.env.VOICE_TOKEN_SECRET,
  publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com",
  model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  voice = process.env.OPENAI_TTS_VOICE ?? "nova",
  speed = Number(process.env.OPENAI_TTS_SPEED ?? 0.9),
  instructions = process.env.OPENAI_TTS_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS,
  tokenTtlSeconds = Number(process.env.VOICE_TOKEN_TTL_SECONDS ?? 86_400),
  now = Date.now,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new RangeError("OPENAI_TTS_SPEED must be between 0.25 and 4.");
  }
  const enabled = Boolean(apiKey && tokenSecret && tokenSecret.length >= 32);
  const metadata = () => enabled
    ? { available: true, provider: "openai", model, voice, disclosure: "AI-generated voice." }
    : { available: false, provider: null, model: null, voice: null, disclosure: "" };

  function sign(payload) {
    const body = encode(deflateRawSync(Buffer.from(JSON.stringify(payload))));
    const signature = createHmac("sha256", tokenSecret).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  function verifyToken(token) {
    try {
      const [body, signature, extra] = String(token).split(".");
      if (!body || !signature || extra || body.length > 8_192) throw new Error();
      const expected = createHmac("sha256", tokenSecret).update(body).digest();
      const actual = decode(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      const inflated = inflateRawSync(decode(body), { maxOutputLength: 8_192 });
      const payload = JSON.parse(inflated.toString("utf8"));
      if (payload.v !== 1 || typeof payload.narration !== "string" || payload.narration.length > 4_096) throw new Error();
      if (payload.expiresAt <= now()) throw new RangeError("Voice token expired");
      return payload;
    } catch (error) {
      if (error instanceof RangeError && /expired/.test(error.message)) throw error;
      throw new TypeError("Invalid voice token");
    }
  }

  function createAudioUrl({ narration, audience }) {
    if (!enabled) return null;
    const token = sign({ v: 1, expiresAt: now() + tokenTtlSeconds * 1_000, narration, audience, model, voice, speed, instructions, format: "mp3" });
    return `${publicOrigin.replace(/\/+$/, "")}/api/speech/${token}`;
  }

  async function generate(payload, { signal } = {}) {
    const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: payload.model ?? model, voice: payload.voice ?? voice, input: payload.narration, instructions: payload.instructions ?? instructions, response_format: "mp3", speed: payload.speed ?? speed }),
      signal,
    });
    if (!response.ok) throw new Error(response.status === 429 ? "Voice quota unavailable" : "Voice provider unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("Invalid voice response");
    return { bytes, contentType: response.headers.get("content-type") ?? "audio/mpeg" };
  }

  return { enabled, metadata, createAudioUrl, verifyToken, generate, tokenDigest: (token) => createHash("sha256").update(token).digest("hex").slice(0, 16) };
}
