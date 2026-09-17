import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createAskLilOwlServer } from "../server.js";
import { createDiagramService } from "../lesson-diagrams.js";
import { createLessonImageService } from "../lesson-images.js";

const diagrams = [
  { kind: "flow", title: "Choose context", steps: ["Review task", "Select context"] },
  { kind: "comparison", title: "Compare prompts", groups: [{ label: "Broad", items: ["Extra context"] }, { label: "Focused", items: ["Relevant context"] }] },
  { kind: "geometry", title: "Three prompt parts", sides: 3, triangulate: true },
];

const lessonArgs = {
  topic: "Saving AI tokens",
  title: "Use fewer tokens",
  audience: "adult beginner",
  depth: "quick",
  slides: [
    { id: "one", title: "Choose", body: "Choose only the context you need.", imagePrompt: "A focused selection shown clearly." },
    { id: "two", title: "Ask", body: "Ask one clear question.", imagePrompt: "A concise question compared with a broad one." },
    { id: "three", title: "Refine", body: "Refine the answer with a short follow-up.", imagePrompt: "Three connected parts of a useful prompt." },
  ],
  quiz: [{ question: "What saves tokens?", choices: ["Focused context", "Extra repetition"], answerIndex: 0 }],
  diagrams,
};

async function connectServer(options = {}) {
  const server = createAskLilOwlServer({ demoMode: false, speechService: {}, ...options });
  const client = new Client({ name: "diagram-workflow-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test("diagram tool is strict, structured-only, and leaves the native file contract unchanged", async (t) => {
  const { server, client } = await connectServer();
  t.after(async () => { await client.close(); await server.close(); });

  const { tools } = await client.listTools();
  const native = tools.find((tool) => tool.name === "create_lesson");
  const diagram = tools.find((tool) => tool.name === "create_diagram_lesson");
  assert.ok(native);
  assert.ok(diagram);
  assert.deepEqual(native._meta["openai/fileParams"], ["images"]);
  assert.deepEqual(Object.keys(native.inputSchema.properties.images.items.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
  assert.equal(diagram.inputSchema.additionalProperties, false);
  assert.equal(diagram.inputSchema.required.includes("diagrams"), true);
  assert.equal("images" in diagram.inputSchema.properties, false);
  assert.equal("openai/fileParams" in diagram._meta, false);
  assert.equal(diagram._meta.ui.resourceUri, native._meta.ui.resourceUri);
});

test("diagram tool renders and caches three real PNGs before one narration request", async (t) => {
  let audioCalls = 0;
  const imageService = createLessonImageService({ publicOrigin: "https://lesson.example", idFactory: (() => { let id = 0; return () => `diagram-${++id}`; })() });
  const { server, client } = await connectServer({
    logger: { info() {}, error() {} },
    diagramService: createDiagramService({ logger: { info() {} } }),
    imageService,
    audioService: { prepare: async ({ narration, audience }) => {
      audioCalls += 1;
      assert.equal(narration, lessonArgs.slides.map((slide) => slide.body).join("\n\n"));
      assert.equal(audience, lessonArgs.audience);
      return { audioUrl: "https://lesson.example/api/assets/narration", voice: { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." } };
    } },
  });
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "create_diagram_lesson", arguments: lessonArgs });
  assert.equal(result.isError, undefined);
  assert.equal(audioCalls, 1);
  assert.equal(result.structuredContent.lesson.visualMode, "diagram");
  assert.equal(result.structuredContent.lesson.images.length, 3);
  for (const image of result.structuredContent.lesson.images) {
    const asset = imageService.resolve(new URL(image.url).pathname.split("/").pop());
    assert.equal(asset.contentType, "image/png");
    assert.equal(asset.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  assert.doesNotMatch(JSON.stringify(result), /<svg|"diagrams"/);
});

test("native MCP responses retain their prior shape without a visual mode field", async (t) => {
  const nativeArgs = {
    ...lessonArgs,
    images: lessonArgs.slides.map((_, index) => ({
      file_id: `file_${index + 1}`,
      download_url: `https://files.example/${index + 1}.png`,
    })),
  };
  delete nativeArgs.diagrams;
  const { server, client } = await connectServer({
    imageService: { prepareMany: async (images) => images },
    audioService: { prepare: async () => ({ audioUrl: "https://lesson.example/audio.mp3" }) },
    logger: { info() {}, error() {} },
  });
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "create_lesson", arguments: nativeArgs });
  assert.equal(result.isError, undefined);
  assert.equal("visualMode" in result.structuredContent.lesson, false);
});

test("diagram validation and preparation failures never return a lesson or spend narration", async (t) => {
  let audioCalls = 0;
  const logs = [];
  const failures = [
    { name: "invalid quiz", args: { ...lessonArgs, quiz: [{ question: "Pick", choices: ["A", "B"], answerIndex: 2 }] } },
    { name: "renderer failure", diagramService: { renderMany: async () => { throw new Error("PRIVATE renderer detail"); } } },
    { name: "cache failure", imageService: { storePngBatch: async () => { throw new Error("PRIVATE cache detail"); } } },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async (t) => {
      const { server, client } = await connectServer({
        diagramService: failure.diagramService ?? createDiagramService({ logger: { info() {} } }),
        imageService: failure.imageService ?? createLessonImageService({ publicOrigin: "https://lesson.example" }),
        audioService: { prepare: async () => { audioCalls += 1; throw new Error("must not narrate"); } },
        logger: { info: (value) => logs.push(value), error: (value) => logs.push(value) },
      });
      t.after(async () => { await client.close(); await server.close(); });
      const result = await client.callTool({ name: "create_diagram_lesson", arguments: failure.args ?? lessonArgs });
      assert.equal(result.isError, true);
      assert.equal("structuredContent" in result, false);
    });
  }

  assert.equal(audioCalls, 0);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|Choose context|Compare prompts|Three prompt parts|https:\/\//);
});

test("malformed diagram input is rejected at the strict tool boundary", async (t) => {
  let audioCalls = 0;
  const { server, client } = await connectServer({ audioService: { prepare: async () => { audioCalls += 1; } } });
  t.after(async () => { await client.close(); await server.close(); });

  assert.ok((await client.listTools()).tools.some((tool) => tool.name === "create_diagram_lesson"));

  const result = await client.callTool({
    name: "create_diagram_lesson",
    arguments: { ...lessonArgs, unexpected: "must not be stripped", diagrams: [{ ...diagrams[0], svg: "<svg/>" }, ...diagrams.slice(1)] },
  });
  assert.equal(result.isError, true);
  assert.equal("structuredContent" in result, false);
  assert.equal(audioCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /<svg|must not be stripped/);
});
