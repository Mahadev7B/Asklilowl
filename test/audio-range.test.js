import assert from "node:assert/strict";
import test from "node:test";
import { createAskLilOwlHttpServer } from "../server.js";

test("cached narration supports browser byte-range seeking without regenerating audio", async (t) => {
  const server = createAskLilOwlHttpServer({
    audioService: { resolve: (id) => id === "fixture" ? { bytes: Buffer.from("0123456789"), contentType: "audio/mpeg" } : null },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/assets/fixture`;
  for (const [range, status, body, contentRange] of [
    [undefined, 200, "0123456789", null],
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=8-100", 206, "89", "bytes 8-9/10"],
    ["bytes=10-", 416, "", "bytes */10"],
    ["bytes=5-2", 416, "", "bytes */10"],
    ["bytes=-0", 416, "", "bytes */10"],
    // Unsupported/malformed ranges may be ignored with the full representation.
    ["bytes=0-1,4-5", 200, "0123456789", null],
    ["nonsense", 200, "0123456789", null],
  ]) {
    const response = await fetch(url, { headers: range ? { Range: range } : {} });
    assert.equal(response.status, status, range ?? "full");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get("content-length"), String(body.length));
  }
  const expired = await fetch(url.replace("fixture", "expired"), { headers: { Range: "bytes=0-1" } });
  assert.equal(expired.status, 410);
});
