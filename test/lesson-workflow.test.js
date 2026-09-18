import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAskLilOwlServer } from "../server.js";

async function connectPreparationServer() {
  const fail = async () => { throw new Error("Preparation must not call an asset service"); };
  const server = createAskLilOwlServer({ demoMode: false, speechService: {}, audioService: { prepare: fail }, imageService: { prepareMany: fail, storePngBatch: fail }, diagramService: { renderMany: fail } });
  const client = new Client({ name: "workflow-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return { server, client };
}

test("every new lesson preparation asks for a fresh style without calling asset services", async (t) => {
  const { server, client } = await connectPreparationServer();
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do bridges stay up?" } });
  assert.equal(result.isError, undefined);
  const workflow = JSON.parse(result.content[0].text);
  assert.equal(workflow.question, "How do bridges stay up?");
  assert.equal(workflow.ready, false);
  assert.equal(workflow.needsStyleSelection, true);
  assert.equal(typeof workflow.masterPrompt, "string");
  assert.ok(workflow.masterPrompt.length > 1000);
  assert.equal(workflow.masterPrompt, client.getInstructions());
  assert.deepEqual(workflow.styleOptions.map(({ value }) => value), ["auto", "kid-friendly", "technical", "professional"]);

  await client.callTool({ name: "prepare_lesson", arguments: { question: "How do bridges stay up?", lessonStyle: "technical" } });
  const another = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do batteries work?" } });
  assert.equal(JSON.parse(another.content[0].text).needsStyleSelection, true);
});

test("each selected lesson style guides all lesson content and explains the native-first fallback", async (t) => {
  const { server, client } = await connectPreparationServer();
  t.after(async () => { await client.close(); await server.close(); });

  for (const lessonStyle of ["auto", "kid-friendly", "technical", "professional"]) {
    const result = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do batteries work?", lessonStyle } });
    const workflow = JSON.parse(result.content[0].text);
    assert.equal(workflow.ready, false);
    assert.equal(workflow.needsStyleSelection, false);
    assert.equal(workflow.lessonStyle, lessonStyle);
    assert.equal(workflow.masterPrompt, client.getInstructions());
    assert.equal(typeof workflow.styleGuidance, "string");
    assert.ok(workflow.styleGuidance.length > 20);
    assert.match(workflow.nextStep, /explanations.*imagePrompt.*diagram.*narration.*quiz/is);
    assert.match(workflow.nextStep, /native.*first|native image generation.*available/is);
    assert.match(workflow.nextStep, /create_diagram_lesson/i);
  }
});

test("preparation rejects unsupported styles and distinguishes follow-ups from consented new lessons", async (t) => {
  const { server, client } = await connectPreparationServer();
  t.after(async () => { await client.close(); await server.close(); });

  const invalid = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do batteries work?", lessonStyle: "cinematic" } });
  assert.equal(invalid.isError, true);

  const result = await client.callTool({ name: "prepare_lesson", arguments: { question: "How do batteries work?", lessonStyle: "auto" } });
  const workflow = JSON.parse(result.content[0].text);
  assert.match(workflow.followUpGuidance, /answer.*conversationally.*examples.*gentle.*check/is);
  assert.match(workflow.followUpGuidance, /offer.*new lesson.*consent.*style/is);
  assert.match(workflow.followUpGuidance, /do not.*narration|without.*narration/is);
});
