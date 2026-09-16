import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createRateLimiter } from "../http-security.js";
import { createAskLilOwlHttpServer } from "../server.js";

async function startServer(options = {}) {
  const server = createAskLilOwlHttpServer(options);
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
    [false, ["create_lesson"]],
    [true, ["create_lesson", "preview_demo_lesson"]],
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
    assert.ok(result.tools[0].outputSchema?.properties?.lesson);

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
  assert.match(description, /simple, slide-specific native ChatGPT educational image/i);
  assert.match(description, /Pass the generated images in the images array in slide order/i);
  // Aborting the call on a failed image handoff hid every near-miss from the logs.
  assert.match(description, /Always call this tool even if the images cannot be attached/i);
  assert.doesNotMatch(description, /if native image generation is unavailable, do not call this tool/i);
  assert.match(description, /avoid dense infographic posters/i);
  assert.match(description, /infer the learner level from the question and conversation context/i);
  assert.match(description, /do not ask the user to choose an audience/i);
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
  // The caller has to be told what to fix, not just that something broke.
  assert.match(invalid.content[0].text, /answerIndex outside its choices array/i);
  assert.match(invalid.content[0].text, /call AskLilOwl again/i);
  assert.deepEqual(events, []);
});

test("production records safe image-handoff diagnostics before narration", async (t) => {
  const events = [];
  const { server, origin } = await startServer({
    demoMode: false,
    logger: { info: (event) => events.push(event) },
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

  assert.deepEqual(events, [
    {
      event: "lesson_image_handoff_received",
      imageCount: 3,
      shapes: ["leaf", "light", "food"].map((name) => ({
        shape: "object",
        fields: {
          file_id: "string(9)".replace("9", String(`file_${name}`.length)),
          download_url: "url(https://files.oaiusercontent.com)",
        },
      })),
      resolvedFrom: ["download_url", "download_url", "download_url"],
      usableCount: 3,
      fileIdCount: 3,
      urlCount: 3,
      imageOrigins: ["https://files.oaiusercontent.com"],
    },
  ]);
});

test("production validates ChatGPT images before creating one narration track", async (t) => {
  let speechCalls = 0;
  const { server, origin } = await startServer({
    demoMode: false,
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
  assert.deepEqual(events, [{ event: "lesson_voice_generation_failed", provider: "voice", status: 429, code: "insufficient_quota", message: "Voice quota unavailable" }]);
});
