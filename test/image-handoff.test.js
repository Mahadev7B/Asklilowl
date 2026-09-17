import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAskLilOwlServer } from "../server.js";

test("in-memory production handoff accepts references and rejects malformed images before audio", async (t) => {
  const events = [];
  let audioCalls = 0;
  const server = createAskLilOwlServer({
    demoMode: false,
    speechService: {},
    audioService: { prepare: async () => {
      audioCalls += 1;
      return { audioUrl: "https://lesson.example/mock.mp3" };
    } },
    logger: { info: (event) => events.push(event) },
  });
  const client = new Client({ name: "image-handoff-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const base = {
    topic: "Solar eclipse", title: "Solar Eclipse", audience: "general learner",
    slides: ["Sun", "Moon", "Shadow"].map((title, i) => ({ id: String(i), title, body: `${title} in a solar eclipse.` })),
    quiz: [{ question: "What blocks the Sun?", choices: ["Moon", "Mars"], answerIndex: 0 }],
  };
  const privateUrl = "https://private-user:private-password@images.example:8443/private-path.png?token=private-token#private-fragment";
  const cases = [
    [{ file_id: "private-file-id" }, "file", null, false],
    [{ download_url: privateUrl }, "url", "https://images.example:8443", false],
    [{ file_id: "private-file-id", download_url: privateUrl }, "both", "https://images.example:8443", true],
    [{}, "neither", null, false],
    [{ download_url: "invalid-private-url" }, "url", null, false],
    [{ download_url: "data:image/png;base64,private-data" }, "url", null, false],
    [{ download_url: privateUrl, extra: "private-extra" }, "url", "https://images.example:8443", false],
    [privateUrl, undefined, undefined, false],
  ];
  for (const [image, referenceKind, urlOrigin, accepted] of cases) {
    events.length = 0;
    const before = audioCalls;
    const result = await client.callTool({ name: "create_lesson", arguments: { ...base, images: base.slides.map(() => image) } });
    assert.equal(Boolean(result.isError), !accepted);
    assert.equal(audioCalls - before, accepted ? 1 : 0);
    const reachesHandler = typeof image === "object" && typeof image.file_id === "string" && typeof image.download_url === "string" && !Object.hasOwn(image, "extra");
    assert.equal(events.length, reachesHandler ? 1 : 0);
    if (!reachesHandler) continue;
    assert.equal(events[0].imageCount, 3);
    for (const received of events[0].received) {
      assert.equal(received.referenceKind, referenceKind);
      assert.equal(received.urlOrigin, urlOrigin);
    }
    assert.doesNotMatch(JSON.stringify(events), /private-/);
    if (accepted) {
      assert.equal(result.structuredContent.lesson.images[0].url, image.download_url ?? null);
      assert.equal(result.structuredContent.lesson.images[0].fileId, image.file_id ?? null);
    } else {
      assert.equal(result.structuredContent, undefined);
    }
  }
  for (const overrides of [
    { images: [] },
    { images: [{ download_url: privateUrl }] },
    { slides: base.slides.slice(0, 2) },
    { quiz: [] },
  ]) {
    const before = audioCalls;
    const result = await client.callTool({ name: "create_lesson", arguments: {
      ...base, images: base.slides.map(() => ({ download_url: privateUrl })), ...overrides,
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(audioCalls, before);
  }
});
