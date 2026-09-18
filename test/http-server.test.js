import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createRateLimiter } from "../http-security.js";
import { createAskLilOwlHttpServer } from "../server.js";
import { createLessonImageService } from "../lesson-images.js";

const PNG_BYTES = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));

async function startServer(options = {}) {
  const server = createAskLilOwlHttpServer({
    imageService: {
      prepareMany: async (images) => images,
      resolve: () => null,
    },
    ...options,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

test("rate limiter uses a fixed window and reports retry timing", () => {
  let now = 10_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });

  assert.equal(limiter.consume("client").allowed, true);
  assert.equal(limiter.consume("client").allowed, true);
  const denied = limiter.consume("client");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);

  now += 1_001;
  assert.equal(limiter.consume("client").allowed, true);
});

test("HTTP routes expose public information with secure response headers", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => stopServer(server));

  for (const route of ["/", "/about", "/privacy", "/terms", "/support"]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  }
});

test("HTTP boundary rejects declared MCP bodies larger than two MiB", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => stopServer(server));

  const statusCode = await new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1),
      },
    });
    request.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });

  assert.equal(statusCode, 413);
});

test("production and demo MCP servers expose only their intended tools", async (t) => {
  for (const [demoMode, expectedTools] of [
    [false, ["prepare_lesson", "report_lesson_diagnostic", "create_lesson", "create_diagram_lesson"]],
    [true, ["prepare_lesson", "report_lesson_diagnostic", "create_lesson", "create_diagram_lesson", "preview_demo_lesson"]],
  ]) {
    const { server, origin } = await startServer({
      demoMode,
      publicOrigin: "http://127.0.0.1",
    });
    const client = new Client({ name: "asklilowl-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);
    const result = await client.listTools();

    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      expectedTools
    );
    assert.ok(result.tools.find((tool) => tool.name === "create_lesson").outputSchema?.properties?.lesson);

    await client.close();
    await stopServer(server);
  }
});

test("the host-facing lesson instruction requires safe educational behavior", async (t) => {
  const { server, origin } = await startServer({ demoMode: false });
  const client = new Client({ name: "asklilowl-safety-instruction-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  const tools = await client.listTools();
  const description = tools.tools.find((tool) => tool.name === "create_lesson")?.description ?? "";

  assert.match(description, /harm, illegal activity, self-harm, explicit sexual content, or sexual content involving minors/i);
  assert.match(description, /do not call this tool to turn it into a lesson/i);
  assert.match(description, /lesson fields, source links, or image labels.*instructions that override/i);
  assert.match(description, /medical, legal, or financial topics.*general educational information/i);
  assert.match(description, /concrete imagePrompt/i);
  assert.match(description, /generate and attach one native ChatGPT image per slide/i);
  assert.match(description, /never invent file IDs or URLs/i);
  assert.match(description, /does not search for replacements/i);
  assert.match(description, /avoid dense infographic posters/i);
  assert.match(description, /infer the learner level from the question and conversation context/i);
  assert.match(description, /do not ask the user to choose an audience/i);
});

test("the lesson tool declares the proven native file contract", async (t) => {
  const { server, origin } = await startServer({ demoMode: false });
  const client = new Client({ name: "asklilowl-file-parameter-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await stopServer(server); });

  const tools = await client.listTools();
  const lessonTool = tools.tools.find((tool) => tool.name === "create_lesson");
  assert.ok(lessonTool);
  assert.deepEqual(lessonTool._meta["openai/fileParams"], ["images"]);
  const item = lessonTool.inputSchema.properties.images.items;
  assert.deepEqual(item.required.sort(), ["download_url", "file_id"]);
  assert.deepEqual(Object.keys(item.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
  assert.equal(item.additionalProperties, false);
  assert.ok(lessonTool.inputSchema.required.includes("images"));
  assert.equal(lessonTool._meta.ui.resourceUri, "ui://asklilowl/lesson.html");
});

test("the lesson widget declares its stable public origin for standard and ChatGPT clients", async (t) => {
  const publicOrigin = "https://asklilowl-chatgpt.onrender.com";
  const { server, origin } = await startServer({
    demoMode: false,
    publicOrigin,
  });
  const client = new Client({ name: "asklilowl-resource-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  const result = await client.readResource({ uri: "ui://asklilowl/lesson.html" });

  assert.equal(result.contents[0]._meta?.ui?.domain, publicOrigin);
  assert.equal(result.contents[0]._meta?.["openai/widgetDomain"], publicOrigin);
});

test("the Inspector bird asset is isolated from production", async (t) => {
  const production = await startServer({ demoMode: false });
  const demo = await startServer({ demoMode: true });
  t.after(async () => {
    await stopServer(production.server);
    await stopServer(demo.server);
  });

  assert.equal((await fetch(`${production.origin}/test-bird.svg`)).status, 404);
  assert.equal((await fetch(`${demo.origin}/test-bird.svg`)).status, 200);
});

test("production serves the generated photosynthesis lesson illustration", async (t) => {
  const { server, origin } = await startServer({ demoMode: false });
  t.after(() => stopServer(server));
  const response = await fetch(`${origin}/photosynthesis-infographic.png`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.ok((await response.arrayBuffer()).byteLength > 100_000);
});

test("production serves temporary proxied lesson images from its own origin", async (t) => {
  const imageService = {
    prepareMany: async (images) => images,
    resolve: (id) => id === "known-image"
      ? { bytes: PNG_BYTES, contentType: "image/png" }
      : null,
  };
  const { server, origin } = await startServer({ demoMode: false, imageService });
  t.after(() => stopServer(server));

  const available = await fetch(`${origin}/api/images/known-image`);
  assert.equal(available.status, 200);
  assert.equal(available.headers.get("content-type"), "image/png");
  assert.equal(available.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await available.arrayBuffer()), PNG_BYTES);
  assert.equal((await fetch(`${origin}/api/images/expired-image`)).status, 410);
});

test("production proxies every URL image before narration and fails atomically", async (t) => {
  let imageCalls = 0;
  let audioCalls = 0;
  const imageService = {
    resolve: () => null,
    prepareMany: async () => {
      imageCalls += 1;
      throw new Error("image unavailable");
    },
  };
  const audioService = {
    prepare: async () => {
      audioCalls += 1;
      return { audioUrl: "https://lesson.example/audio.mp3" };
    },
    resolve: () => null,
  };
  const { server, origin } = await startServer({ demoMode: false, imageService, audioService });
  const client = new Client({ name: "asklilowl-image-proxy-order-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await stopServer(server); });

  const result = await client.callTool({
    name: "create_lesson",
    arguments: {
      topic: "Solar eclipse", title: "Solar Eclipse", audience: "general learner",
      slides: ["Sun", "Moon", "Shadow"].map((title, index) => ({ id: String(index), title, body: `${title} helps explain an eclipse.` })),
      images: ["sun", "moon", "shadow"].map((name) => ({ file_id: `file_${name}`, download_url: `https://images.example/${name}.png` })),
      quiz: [{ question: "What moves between Earth and the Sun?", choices: ["Moon", "Mars"], answerIndex: 0 }],
    },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.equal(imageCalls, 1);
  assert.equal(audioCalls, 0);
});

test("production creates a lesson through the real proxy and serves its prepared images", async (t) => {
  const imageService = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
    dispatcherFactory: () => ({ close: async () => {} }),
    fetchImpl: async () => new Response(PNG_BYTES, {
      headers: { "content-type": "image/png" },
    }),
  });
  const audioService = {
    prepare: async () => ({
      audioUrl: "https://lesson.example/audio.mp3",
      voice: { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." },
    }),
    resolve: () => null,
  };
  const { server, origin } = await startServer({
    demoMode: false,
    publicOrigin: "https://lesson.example",
    imageService,
    audioService,
    logger: { info: () => {} },
  });
  const client = new Client({ name: "asklilowl-real-image-proxy-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await stopServer(server); });

  const result = await client.callTool({
    name: "create_lesson",
    arguments: {
      topic: "Solar eclipse", title: "Solar Eclipse", audience: "general learner",
      slides: ["Sun", "Moon", "Shadow"].map((title, index) => ({ id: String(index), title, body: `${title} helps explain an eclipse.` })),
      images: ["sun", "moon", "shadow"].map((name) => ({ file_id: `file_${name}`, download_url: `https://images.example/${name}.png` })),
      quiz: [{ question: "What moves between Earth and the Sun?", choices: ["Moon", "Mars"], answerIndex: 0 }],
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.lesson.images.length, 3);
  const preparedUrl = new URL(result.structuredContent.lesson.images[0].url);
  assert.equal(preparedUrl.origin, "https://lesson.example");
  const imageResponse = await fetch(`${origin}${preparedUrl.pathname}`);
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), PNG_BYTES);
});

test("production downloads native images before making one narration request", async (t) => {
  const order = [];
  const imageService = {
    resolve: () => null,
    async prepareMany(images) {
      order.push("images");
      assert.equal(images.length, 3);
      return images.map((image, index) => ({ ...image, download_url: `https://lesson.example/api/images/${index}` }));
    },
    async prepareForLesson() { throw new Error("Public sourcing must never run"); },
  };
  const audioService = {
    resolve: () => null,
    async prepare() {
      order.push("audio");
      return {
        audioUrl: "https://lesson.example/api/assets/audio",
        voice: { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." },
      };
    },
  };
  const { server, origin } = await startServer({ demoMode: false, imageService, audioService, logger: { info: () => {} } });
  const client = new Client({ name: "asklilowl-public-image-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await stopServer(server); });

  const result = await client.callTool({
    name: "create_lesson",
    arguments: {
      images: [0, 1, 2].map((i) => ({ file_id: `file_${i}`, download_url: `https://files.example/${i}.png` })),
      topic: "Area of a regular octagon",
      title: "Octagon Area",
      audience: "general learner",
      slides: [
        { id: "shape", title: "The shape", body: "A regular octagon has eight equal sides.", imagePrompt: "clean regular octagon" },
        { id: "apothem", title: "The apothem", body: "The apothem reaches the middle of a side.", imagePrompt: "regular octagon with labeled apothem" },
        { id: "triangles", title: "Eight triangles", body: "Divide the octagon into eight equal triangles.", imagePrompt: "octagon divided into eight equal triangles" },
      ],
      quiz: [{ question: "How many sides?", choices: ["Eight", "Six"], answerIndex: 0 }],
    },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(order, ["images", "audio"]);
  assert.equal(result.structuredContent.lesson.images.length, 3);
  assert.equal(result.structuredContent.lesson.images[1].fileId, "file_1");
});

test("production MCP returns schema-conformant lessons and actionable quiz errors", async (t) => {
  const events = [];
  const { server, origin } = await startServer({
    demoMode: false,
    logger: { error: (event) => events.push(event) },
    speechOptions: {
      apiKey: "test-key",
      tokenSecret: "s".repeat(32),
      fetchImpl: async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    },
  });
  const client = new Client({ name: "asklilowl-call-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  const lessonArguments = {
    topic: "How do birds fly?",
    title: "Bird Flight",
    audience: "young learner",
    depth: "quick",
    summary: "Learn how wings and air work together.",
    objectives: ["Explain lift."],
    slides: [
      { id: "one", title: "Wings", body: "Wings push air down." },
      { id: "two", title: "Lift", body: "Air pushes the bird up." },
      { id: "three", title: "Steering", body: "Tail feathers steer." },
    ],
    images: ["one", "two", "three"].map((name) => ({
      file_id: `file_${name}`,
      download_url: `https://files.example/${name}.png`,
    })),
    quiz: [
      {
        question: "What helps a bird steer?",
        choices: ["Tail feathers", "Its beak"],
        answerIndex: 0,
      },
    ],
    sources: [{ title: "Bird reference", url: "https://example.org/birds" }],
  };

  const valid = await client.callTool({
    name: "create_lesson",
    arguments: lessonArguments,
  });
  assert.equal(valid.isError, undefined);
  assert.equal(valid.structuredContent.lesson.isDemo, false);
  assert.equal(valid.structuredContent.lesson.slideCount, 3);
  assert.equal(valid.structuredContent.lesson.sources.length, 1);

  lessonArguments.quiz[0].answerIndex = 2;
  const invalid = await client.callTool({
    name: "create_lesson",
    arguments: lessonArguments,
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /answerIndex outside/);
  assert.deepEqual(events.map(event => event.event), ["lesson_stage_failed", "lesson_submission_failed"]);
  assert.equal(events[0].stage, "content_validation");
});

test("production records safe image-handoff diagnostics before narration", async (t) => {
  const events = [];
  const { server, origin } = await startServer({
    demoMode: false,
    logger: { info: (event) => events.push(event) },
    imageService: {
      resolve: () => null,
      async prepareMany(images) { return images; },
    },
    speechOptions: {
      apiKey: "test-key",
      tokenSecret: "s".repeat(32),
      fetchImpl: async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    },
  });
  const client = new Client({ name: "asklilowl-image-diagnostic-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  await client.callTool({
    name: "create_lesson",
    arguments: {
      topic: "Why leaves are green",
      title: "Why Leaves Are Green",
      audience: "young learner",
      depth: "quick",
      summary: "A short lesson about chlorophyll.",
      slides: [
        { id: "one", title: "Green pigment", body: "Leaves contain chlorophyll." },
        { id: "two", title: "Catching light", body: "Chlorophyll helps leaves use sunlight." },
        { id: "three", title: "Making food", body: "Plants use that energy to make food." },
      ],
      images: [
        {
          file_id: "file_leaf",
          download_url: "https://files.oaiusercontent.com/lesson-leaf.png",
        },
        {
          file_id: "file_light",
          download_url: "https://files.oaiusercontent.com/lesson-light.png",
        },
        {
          file_id: "file_food",
          download_url: "https://files.oaiusercontent.com/lesson-food.png",
        },
      ],
      quiz: [
        { question: "What makes leaves green?", choices: ["Chlorophyll", "Clouds"], answerIndex: 0 },
      ],
    },
  });

  const handoffs = events.filter(event => event.event === "lesson_image_handoff_received");
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].imageCount, 3);
  assert.equal(handoffs[0].fileIdCount, 3);
  assert.ok(events.every(event => event.diagnosticId === handoffs[0].diagnosticId));
  assert.ok(events.some(event => event.event === "lesson_ready"));
  assert.deepEqual(handoffs[0].received[0], {
    type: "object",
    keys: ["download_url", "file_id"],
    valueTypes: { download_url: "string", file_id: "string" },
    referenceKind: "both",
    urlOrigin: "https://files.oaiusercontent.com",
  });
});

test("production rejects malformed native file contracts before narration", async (t) => {
  const events = [];
  let narrationCalls = 0;
  const { server, origin } = await startServer({
    demoMode: false,
    logger: { info: (event) => events.push(event) },
    imageService: {
      resolve: () => null,
      async prepareMany(images) { return images; },
    },
    audioService: {
      enabled: true,
      prepare: async () => {
        narrationCalls += 1;
        return { audioUrl: "https://lesson.example/audio.mp3", voice: { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." } };
      },
    },
  });
  const client = new Client({ name: "asklilowl-malformed-image-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await stopServer(server); });

  const base = {
    topic: "Bird flight", title: "Bird Flight", audience: "general learner",
    slides: [
      { id: "one", title: "Wings", body: "Wings move air." },
      { id: "two", title: "Lift", body: "Air pushes up." },
      { id: "three", title: "Tail", body: "Tails steer." },
    ],
    quiz: [{ question: "What steers?", choices: ["Tail", "Beak"], answerIndex: 0 }],
  };
  const cases = [
    ["omitted", undefined, { imageCount: 0, received: [] }, true],
    ["file_id_only", [{ file_id: "file_one" }], { imageCount: 1, received: [{ type: "object", keys: ["file_id"], valueTypes: { file_id: "string" } }] }, true],
    ["extra_key", [
      { file_id: "file_one", download_url: "https://files.example/1.png", extra: true },
      { file_id: "file_two", download_url: "https://files.example/2.png" },
      { file_id: "file_three", download_url: "https://files.example/3.png" },
    ], { imageCount: 3, received: [{ type: "object", keys: ["download_url", "extra", "file_id"], valueTypes: { download_url: "string", extra: "boolean", file_id: "string" } }] }, true],
    ["well_formed", ["one", "two", "three"].map((name) => ({ file_id: `file_${name}`, download_url: `https://files.example/${name}.png` })), { imageCount: 3, received: [{ type: "object", keys: ["download_url", "file_id"], valueTypes: { download_url: "string", file_id: "string" } }] }, false],
  ];

  for (const [name, images, expectedLog, shouldError] of cases) {
    events.length = 0;
    const result = await client.callTool({ name: "create_lesson", arguments: { ...base, ...(images === undefined ? {} : { images }) } });
    assert.equal(Boolean(result.isError), shouldError, name);
    const handoffs = events.filter(event => event.event === "lesson_image_handoff_received");
    assert.equal(handoffs.length, shouldError ? 0 : 1, name);
    if (shouldError) continue;
    assert.equal(handoffs[0].imageCount, expectedLog.imageCount, name);
    assert.deepEqual(handoffs[0].received.slice(0, 1).map(({ type, keys, valueTypes }) => ({ type, keys, valueTypes })), expectedLog.received, name);
  }
  assert.equal(narrationCalls, 1);
});

test("production rejects missing native images before creating one narration track", async (t) => {
  let speechCalls = 0;
  const { server, origin } = await startServer({
    demoMode: false,
    imageService: {
      resolve: () => null,
      async prepareMany(images) { return images; },
    },
    speechOptions: {
      apiKey: "test-key",
      tokenSecret: "s".repeat(32),
      publicOrigin: "https://lesson.example",
      fetchImpl: async () => {
        speechCalls += 1;
        return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
    },
  });
  const client = new Client({ name: "asklilowl-voice-order-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  const baseLesson = {
    topic: "How glass is made",
    title: "Making Glass",
    audience: "general learner",
    slides: [
      { id: "one", title: "Sand", body: "Glass begins with sand rich in silica." },
      { id: "two", title: "Heat", body: "A furnace melts the mixture into a glowing liquid." },
      { id: "three", title: "Cool", body: "Slow cooling makes the finished glass strong." },
    ],
    quiz: [{ question: "What is heated to make glass?", choices: ["Sand mixture", "Wood"], answerIndex: 0 }],
  };

  const missingImages = await client.callTool({ name: "create_lesson", arguments: baseLesson });
  assert.equal(missingImages.isError, true);
  assert.equal(missingImages.structuredContent, undefined);
  assert.equal(speechCalls, 0);

  const completeLesson = await client.callTool({
    name: "create_lesson",
    arguments: {
      ...baseLesson,
      images: ["one", "two", "three"].map((name) => ({
        file_id: `file_${name}`,
        download_url: `https://files.example/${name}.png`,
      })),
    },
  });
  assert.equal(completeLesson.isError, undefined);
  assert.equal(completeLesson.structuredContent.lesson.images.length, 3);
  assert.match(completeLesson.structuredContent.lesson.audioUrl, /\/api\/assets\//);
  assert.equal(speechCalls, 1);
  const audio = await fetch(`${origin}${new URL(completeLesson.structuredContent.lesson.audioUrl).pathname}`);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/mpeg");
  assert.equal(speechCalls, 1);
});

test("lesson failures log only sanitized voice-provider diagnostics", async (t) => {
  const events = [];
  const failure = Object.assign(new Error("Voice quota unavailable"), {
    provider: "voice",
    status: 429,
    code: "insufficient_quota",
  });
  const audioService = {
    enabled: true,
    prepare: async () => {
      throw failure;
    },
  };
  const { server, origin } = await startServer({
    demoMode: false,
    audioService,
    logger: { error: (event) => events.push(event) },
  });
  const client = new Client({ name: "asklilowl-diagnostic-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await stopServer(server);
  });

  const result = await client.callTool({
    name: "create_lesson",
    arguments: {
      topic: "RAG in AI",
      title: "RAG",
      audience: "general learner",
      slides: [
        { id: "one", title: "Retrieve", body: "Find useful information first." },
        { id: "two", title: "Augment", body: "Give the information to the model." },
        { id: "three", title: "Generate", body: "The model answers using that context." },
      ],
      images: ["one", "two", "three"].map((name) => ({ file_id: `file_${name}`, download_url: `https://files.example/${name}.png` })),
      quiz: [{ question: "What does RAG retrieve?", choices: ["Information", "A new model"], answerIndex: 0 }],
    },
  });

  assert.equal(result.isError, true);
  assert.deepEqual(events.filter(e => e.event === "lesson_voice_generation_failed"), [{ event: "lesson_voice_generation_failed", provider: "voice", status: 429, code: "insufficient_quota", message: "Voice quota unavailable" }]);
  const stageFailure = events.find(e => e.event === "lesson_stage_failed");
  assert.equal(stageFailure.stage, "narration_preparation");
  assert.equal(stageFailure.evidence, "server_observed");
  assert.match(stageFailure.diagnosticId, /^[0-9a-f-]{36}$/);
  assert.equal(events.find(e => e.event === "lesson_submission_failed").diagnosticId, stageFailure.diagnosticId);
});
