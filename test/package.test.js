import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { validatePluginPackage } from "../scripts/validate-package.js";

const root = new URL("../", import.meta.url);

test("portable and compatibility manifests describe the same AskLilOwl product", async () => {
  const portable = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));
  const mcp = JSON.parse(await readFile(new URL("mcp.json", root), "utf8"));
  const compatibility = JSON.parse(
    await readFile(new URL(".codex-plugin/plugin.json", root), "utf8")
  );
  const result = await validatePluginPackage(root);

  assert.deepEqual(result.errors, []);
  assert.equal(portable.name, "asklilowl");
  assert.equal(portable.version, compatibility.version);
  assert.equal(compatibility.mcpServers, "./.mcp.json");
  assert.equal(mcp.mcpServers.asklilowl.type, "streamable-http");
  assert.match(mcp.mcpServers.asklilowl.url, /^https:\/\/[^/]+\/mcp$/);
  assert.equal(
    portable.extensions["com.openai"].interface.developerName,
    "Mahadev7B"
  );
  assert.ok(
    portable.extensions["com.openai"].interface.defaultPrompt.length <= 3
  );
});

test("plugin package includes valid raster identity assets", async () => {
  const result = await validatePluginPackage(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.assets["./assets/asklilowl-icon.png"].dimensions, [512, 512]);
  assert.deepEqual(result.assets["./assets/asklilowl-logo.png"].dimensions, [1024, 1024]);
});

test("package validation rejects missing diagram runtime files", async (t) => {
  const fixturePath = await mkdtemp(path.join(tmpdir(), "asklilowl-package-"));
  t.after(() => rm(fixturePath, { recursive: true, force: true }));

  await mkdir(path.join(fixturePath, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(fixturePath, "assets"), { recursive: true });
  for (const relativePath of [
    "plugin.json",
    "mcp.json",
    ".codex-plugin/plugin.json",
    "assets/asklilowl-icon.png",
    "assets/asklilowl-logo.png",
  ]) {
    await cp(new URL(relativePath, root), path.join(fixturePath, relativePath));
  }

  const result = await validatePluginPackage(
    new URL("./", pathToFileURL(`${fixturePath}${path.sep}`))
  );

  assert.deepEqual(result.errors, [
    "Required package file is missing: diagram-worker.js.",
    "Required package file is missing: assets/fonts/NotoSans-Regular.ttf.",
    "Required package file is missing: assets/fonts/OFL.txt.",
  ]);
});
