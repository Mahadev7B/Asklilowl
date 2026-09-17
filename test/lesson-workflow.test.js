import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAskLilOwlServer } from "../server.js";

test("preparation can start from a question without images or paid services", async (t) => {
  const fail = async () => { throw new Error("Preparation must not call an asset service"); };
  const server = createAskLilOwlServer({ demoMode: false, speechService: {}, audioService: { prepare: fail }, imageService: { prepareMany: fail } });
  const client = new Client({ name: "workflow-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);
  const result = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do bridges stay up?" } });
  assert.equal(result.isError, undefined);
  const workflow = JSON.parse(result.content[0].text);
  assert.equal(workflow.question, "How do bridges stay up?");
  assert.equal(workflow.ready, false);
  assert.match(workflow.nextStep, /native image generation/i);
  assert.match(workflow.nextStep, /create_lesson/);
  assert.match(workflow.nextStep, /do not invent/i);
});
