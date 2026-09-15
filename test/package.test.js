import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
