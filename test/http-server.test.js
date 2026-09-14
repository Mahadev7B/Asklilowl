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

test("production MCP returns schema-conformant lessons and actionable quiz errors", async (t) => {
  const { server, origin } = await startServer({ demoMode: false });
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
  assert.match(invalid.content[0].text, /answerIndex/);
});
