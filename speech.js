const DEFAULT_INSTRUCTIONS = "Speak like a friendly, playful, reassuring teacher for children. Sound natural and conversational, with gentle enthusiasm and a little sense of wonder. Use a warm, welcoming tone and relaxed pacing. Add brief natural pauses after discoveries. Never sound formal, stern, rushed, dramatic, or like an announcer. Pronounce educational words clearly without overemphasis.";

async function providerFailure(response, message) {
  let code = null;
  try {
    const payload = await response.json();
    if (typeof payload?.error?.code === "string") code = payload.error.code;
  } catch {
    // Provider responses are not guaranteed to be JSON. Keep diagnostics bounded.
  }

  const error = new Error(message);
  error.provider = "voice";
  error.status = response.status;
  error.code = code;
  return error;
}

export function createSpeechService({
  apiKey = process.env.OPENAI_API_KEY,
  tokenSecret = process.env.VOICE_TOKEN_SECRET,
  model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  voice = process.env.OPENAI_TTS_VOICE ?? "nova",
  speed = Number(process.env.OPENAI_TTS_SPEED ?? 0.9),
  instructions = process.env.OPENAI_TTS_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new RangeError("OPENAI_TTS_SPEED must be between 0.25 and 4.");
  }
  const enabled = Boolean(apiKey && tokenSecret && tokenSecret.length >= 32);
  const metadata = () => enabled
    ? { available: true, provider: "openai", model, voice, disclosure: "AI-generated voice." }
    : { available: false, provider: null, model: null, voice: null, disclosure: "" };

  async function generate(payload, { signal } = {}) {
    const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: payload.model ?? model, voice: payload.voice ?? voice, input: payload.narration, instructions: payload.instructions ?? instructions, response_format: "mp3", speed: payload.speed ?? speed }),
      signal,
    });
    if (!response.ok) {
      throw await providerFailure(response, response.status === 429 ? "Voice quota unavailable" : "Voice provider unavailable");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("Invalid voice response");
    return { bytes, contentType: response.headers.get("content-type") ?? "audio/mpeg" };
  }

  return { enabled, metadata, generate };
}
