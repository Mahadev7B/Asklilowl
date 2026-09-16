import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// AskLilOwl must never generate images itself: every slide image comes from the
// ChatGPT conversation. Enforcing that here, rather than by asking the model not
// to call the tool, keeps the rule true no matter what the prompt says.
const IMAGE_GENERATION_ENDPOINTS = [
  "v1/images/generations",
  "v1/images/edits",
  "v1/images/variations",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.name.endsWith(".js") && entryPath !== fileURLToPath(import.meta.url)
      ? [entryPath]
      : [];
  });
}

test("no source file calls an OpenAI image generation endpoint", () => {
  const offenders = sourceFiles(path.join(projectRoot, "..")).filter((file) => {
    const contents = readFileSync(file, "utf8");
    return IMAGE_GENERATION_ENDPOINTS.some((endpoint) => contents.includes(endpoint));
  });

  assert.deepEqual(
    offenders.map((file) => path.relative(path.join(projectRoot, ".."), file)),
    [],
    "Slide images must come from ChatGPT, never from a server-side image API."
  );
});

test("the speech service is the only OpenAI endpoint the server calls", () => {
  const endpoints = new Set();
  for (const file of sourceFiles(path.join(projectRoot, ".."))) {
    for (const match of readFileSync(file, "utf8").matchAll(/https:\/\/api\.openai\.com\/[\w/.-]+/g)) {
      endpoints.add(match[0]);
    }
  }

  assert.deepEqual([...endpoints], ["https://api.openai.com/v1/audio/speech"]);
});
