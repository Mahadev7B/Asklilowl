import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNativeImageProbe } from "../native-image-probe.js";

test("native probe advertises complete file contract and distinguishes receipt from download", async (t) => {
  const events = [];
  let downloads = 0;
  let fail = false;
  const server = new McpServer({ name: "probe", version: "1.0.0" });
  registerNativeImageProbe(server, {
    logger: { info: (e) => events.push(e) },
    imageService: {
      prepareMany: async () => {
        downloads++;
        if (fail) throw new Error("secret-url-token");
        return [{ download_url: "https://app.example/api/images/asset" }];
      },
      resolve: () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
    },
  });
  const client = new Client({ name: "probe-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st);
  await client.connect(ct);
  const { tools } = await client.listTools();
  const tool = tools.find((tool) => tool.name === "probe_native_image");
  assert.deepEqual(tool._meta["openai/fileParams"], ["image"]);
  const schema = tool.inputSchema.properties.image;
  assert.deepEqual(schema.required.sort(), ["download_url", "file_id"]);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
  const image = { file_id: "secret-file", download_url: "https://files.example/image?secret-token" };
  const call = (image) => client.callTool({ name: "probe_native_image", arguments: { image } });
  const success = await call(image);
  assert.equal(success.isError, undefined);
  assert.equal(success.content[1].type, "image");
  assert.equal(events[0].origin, "https://files.example");
  assert.equal(events[1].bytes, 3);
  fail = true;
  assert.equal((await call(image)).isError, true);
  assert.equal(events.at(-1).event, "native_image_probe_download_failed");
  for (const invalid of [{ file_id: "secret-file" }, { download_url: image.download_url }, {}, { ...image, extra: true }]) {
    const result = await call(invalid);
    assert.equal(result.isError, true);
  }
  assert.equal(downloads, 2);
  assert.doesNotMatch(JSON.stringify(events), /secret/);
});
