import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvalCorpus } from "../scripts/validate-evals.js";

const evalPath = new URL("../evals/cases.json", import.meta.url);

test("evaluation corpus covers launch-critical tool decisions", async () => {
  const corpus = JSON.parse(await readFile(evalPath, "utf8"));
  const result = validateEvalCorpus(corpus);
  assert.deepEqual(result.errors, []);

  const positive = corpus.cases.filter((item) => item.type === "positive");
  const negative = corpus.cases.filter((item) => item.type === "negative");
  assert.ok(positive.length >= 5);
  assert.ok(negative.length >= 3);
  assert.ok(positive.some((item) => item.expected.requiresFreshResearch));
  assert.ok(positive.some((item) => item.expected.audience === "young learner"));
  assert.ok(positive.some((item) => item.expected.audience === "adult technical learner"));
  assert.ok(negative.some((item) => item.tags.includes("model-selection")));
  assert.ok(negative.some((item) => item.tags.includes("unsupported-action")));
});
