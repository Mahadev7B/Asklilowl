import assert from "node:assert/strict";
import test from "node:test";

import { createLessonImageService } from "../lesson-images.js";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];

test("image service stores a bounded public raster image behind the AskLilOwl origin", async () => {
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  });

  const [prepared] = await service.prepareMany([
    { download_url: "https://images.example/eclipse.png" },
  ]);

  assert.match(prepared.download_url, /^https:\/\/lesson\.example\/api\/images\/[0-9a-f-]+$/);
  assert.equal(prepared.mime_type, "image/png");
  const id = new URL(prepared.download_url).pathname.split("/").pop();
  assert.deepEqual(service.resolve(id)?.bytes, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});

test("image fetch timeout remains active while the response body is read", async () => {
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(new Error("body aborted")), { once: true });
      },
    }), { status: 200, headers: { "content-type": "image/png" } }),
  });

  const outcome = await Promise.race([
    service.prepareMany([{ download_url: "https://images.example/slow.png" }])
      .then(() => "resolved", () => "rejected"),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);

  assert.equal(outcome, "rejected");
});

test("image fetch uses a dispatcher pinned to the validated public DNS result", async () => {
  const pinned = { close: async () => {} };
  let dispatcherInput;
  let fetchDispatcher;
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: async () => [{ address: "8.8.4.4", family: 4 }],
    dispatcherFactory: (url, records) => {
      dispatcherInput = { hostname: url.hostname, records };
      return pinned;
    },
    fetchImpl: async (_url, options) => {
      fetchDispatcher = options.dispatcher;
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    },
  });

  await service.prepareMany([{ download_url: "https://images.example/safe.png" }]);

  assert.deepEqual(dispatcherInput, {
    hostname: "images.example",
    records: [{ address: "8.8.4.4", family: 4 }],
  });
  assert.equal(fetchDispatcher, pinned);
});

test("image service rejects special-use DNS addresses before fetching", async () => {
  let fetchCalls = 0;
  const service = createLessonImageService({
    lookupImpl: async () => [{ address: "100.64.0.1", family: 4 }],
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
    },
  });

  await assert.rejects(
    service.prepareMany([{ download_url: "https://images.example/private.png" }]),
    /not publicly reachable/i
  );
  assert.equal(fetchCalls, 0);
});

test("image service commits no cached assets when any lesson image fails", async () => {
  let fetchCalls = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    idFactory: () => "staged-image",
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 2) throw new Error("second image failed");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    },
  });

  await assert.rejects(service.prepareMany([
    { download_url: "https://images.example/one.png" },
    { download_url: "https://images.example/two.png" },
  ]));
  assert.equal(service.resolve("staged-image"), null);
});

test("image service enforces an aggregate lesson image byte limit", async () => {
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    maxLessonImageBytes: 6,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-type": "image/png" },
    }),
  });

  await assert.rejects(service.prepareMany([
    { download_url: "https://images.example/one.png" },
    { download_url: "https://images.example/two.png" },
  ]), /lesson images are too large/i);
});

test("image service bounds DNS resolution time", async () => {
  const service = createLessonImageService({
    timeoutMs: 5,
    lookupImpl: async () => new Promise(() => {}),
  });

  const outcome = await Promise.race([
    service.prepareMany([{ download_url: "https://images.example/hung.png" }])
      .then(() => "resolved", () => "rejected"),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 50)),
  ]);
  assert.equal(outcome, "rejected");
});

test("image service rejects invalid resource-limit configuration", () => {
  for (const options of [
    { maxImageBytes: Number.NaN },
    { maxLessonImageBytes: 0 },
    { maxCacheBytes: -1 },
    { maxConcurrentDownloads: 0 },
    { timeoutMs: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => createLessonImageService(options), /must be a finite positive/i);
  }
});
