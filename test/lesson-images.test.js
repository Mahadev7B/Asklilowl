import assert from "node:assert/strict";
import test from "node:test";

import { createLessonImageService } from "../lesson-images.js";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
const PNG_BYTES = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));

function localDiagramPng(size = PNG_BYTES.byteLength) {
  const minimumSize = PNG_BYTES.byteLength;
  const bytes = Buffer.alloc(Math.max(size, minimumSize));
  Buffer.from(PNG_BYTES).copy(bytes);
  bytes.writeUInt32BE(1200, 16);
  bytes.writeUInt32BE(675, 20);
  if (bytes.length > minimumSize) {
    Buffer.from(PNG_BYTES).subarray(-12).copy(bytes, bytes.length - 12);
  }
  return bytes;
}

test("image service stores a bounded public raster image behind the AskLilOwl origin", async () => {
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(PNG_BYTES, {
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
  assert.deepEqual(service.resolve(id)?.bytes, PNG_BYTES);
});

test("image service finds one relevant public image per slide when none are supplied", async () => {
  const requests = [];
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    publicImageProvider: {
      async find(request) {
        requests.push(request);
        return {
          download_url: `https://upload.wikimedia.org/${requests.length}.png`,
          mime_type: "image/png",
          file_name: `visual-${requests.length}.png`,
          title: `Visual ${requests.length}`,
          source_page_url: `https://commons.wikimedia.org/wiki/File:Visual_${requests.length}.png`,
          creator: "Example creator",
          license_name: "CC0 1.0",
          license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
          source_organization: "Wikimedia Commons",
          description: request.query,
        };
      },
    },
    fetchImpl: async () => new Response(PNG_BYTES, {
      headers: { "content-type": "image/png" },
    }),
  });

  const prepared = await service.prepareForLesson({
    topic: "Area of an octagon",
    audience: "general learner",
    slides: [
      { title: "The shape", body: "A regular octagon has eight sides.", imagePrompt: "clean regular octagon" },
      { title: "The apothem", body: "The apothem reaches a side.", imagePrompt: "regular octagon with apothem" },
      { title: "Eight triangles", body: "Divide it into triangles.", imagePrompt: "octagon divided into eight triangles" },
    ],
  });

  assert.equal(requests.length, 3);
  assert.equal(prepared.length, 3);
  assert.match(prepared[0].download_url, /^https:\/\/lesson\.example\/api\/images\//);
  assert.equal(prepared[0].license_name, "CC0 1.0");
  assert.match(requests[2].query, /octagon divided into eight triangles/i);
});

test("image service replaces a missing slide-specific visual with a verified topic visual", async () => {
  const requests = [];
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    publicImageProvider: {
      async find(request) {
        requests.push(request);
        if (request.query !== "Bridge engineering") return null;
        return {
          download_url: "https://upload.wikimedia.org/bridge.png",
          mime_type: "image/png",
          source_page_url: "https://commons.wikimedia.org/wiki/File:Bridge.png",
          license_name: "CC0 1.0",
          description: "Bridge engineering",
        };
      },
    },
    fetchImpl: async () => new Response(PNG_BYTES, {
      headers: { "content-type": "image/png" },
    }),
  });

  const [prepared] = await service.prepareForLesson({
    topic: "Bridge engineering",
    audience: "general learner",
    slides: [{
      title: "Loads move into the ground",
      body: "Foundations transfer bridge loads into strong soil or rock.",
      imagePrompt: "force arrows through bridge foundations into bedrock",
    }],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].query, "force arrows through bridge foundations into bedrock");
  assert.equal(requests[1].query, "Bridge engineering");
  assert.match(prepared.download_url, /^https:\/\/lesson\.example\/api\/images\//);
});

test("production image discovery does not trust self-declared supplied attribution", async () => {
  let providerCalls = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    publicImageProvider: {
      async find(request) {
        providerCalls += 1;
        return {
          download_url: "https://upload.wikimedia.org/verified.png",
          mime_type: "image/png",
          source_page_url: "https://commons.wikimedia.org/wiki/File:Verified.png",
          license_name: "CC0 1.0",
          description: request.query,
        };
      },
    },
    fetchImpl: async () => new Response(PNG_BYTES, {
      headers: { "content-type": "image/png" },
    }),
  });

  const [prepared] = await service.prepareForLesson({
    topic: "Photosynthesis",
    audience: "general learner",
    slides: [{ title: "Sunlight", body: "Leaves capture light.", imagePrompt: "leaf in sunlight" }],
    images: [{
      download_url: "https://unverified.example/unrelated.png",
      source_page_url: "https://unverified.example/claim",
      license_name: "CC0 1.0",
    }],
  });

  assert.equal(providerCalls, 1);
  assert.equal(prepared.source_page_url, "https://commons.wikimedia.org/wiki/File:Verified.png");
});

test("production retains a supplied Commons candidate only after provider verification", async () => {
  let findCalls = 0;
  let verifyCalls = 0;
  const verified = {
    download_url: "https://upload.wikimedia.org/verified.png",
    mime_type: "image/png",
    source_page_url: "https://commons.wikimedia.org/wiki/File:Verified.png",
    license_name: "CC0 1.0",
    description: "leaf in sunlight",
  };
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    publicImageProvider: {
      async verify() {
        verifyCalls += 1;
        return verified;
      },
      async find() {
        findCalls += 1;
        return null;
      },
    },
    fetchImpl: async () => new Response(PNG_BYTES, { headers: { "content-type": "image/png" } }),
  });

  const [prepared] = await service.prepareForLesson({
    topic: "Photosynthesis",
    audience: "general learner",
    slides: [{ title: "Sunlight", body: "Leaves capture light.", imagePrompt: "leaf in sunlight" }],
    images: [{
      download_url: "https://upload.wikimedia.org/unverified.png",
      source_page_url: "https://commons.wikimedia.org/wiki/File:Verified.png",
      license_name: "CC0 1.0",
    }],
  });

  assert.equal(verifyCalls, 1);
  assert.equal(findCalls, 0);
  assert.equal(prepared.source_page_url, verified.source_page_url);
});

test("a verification rate limit reuses an earlier verified supplied visual", async () => {
  let verifyCalls = 0;
  let findCalls = 0;
  let fetchCalls = 0;
  const verified = {
    download_url: "https://upload.wikimedia.org/verified-bridge.png",
    mime_type: "image/png",
    source_page_url: "https://commons.wikimedia.org/wiki/File:Verified_bridge.png",
    license_name: "CC0 1.0",
    description: "bridge structure",
  };
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    logger: { info() {} },
    publicImageProvider: {
      async verify() {
        verifyCalls += 1;
        if (verifyCalls === 2) {
          const error = new Error("verification rate limited");
          error.status = 429;
          throw error;
        }
        return verified;
      },
      async find() {
        findCalls += 1;
        return null;
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
    },
  });

  const prepared = await service.prepareForLesson({
    topic: "Bridge engineering",
    audience: "general learner",
    slides: [
      { title: "Deck", body: "The deck carries traffic.", imagePrompt: "bridge deck" },
      { title: "Beams", body: "Beams resist bending.", imagePrompt: "bridge beams" },
      { title: "Piers", body: "Piers carry loads downward.", imagePrompt: "bridge piers" },
    ],
    images: [
      { source_page_url: "https://commons.wikimedia.org/wiki/File:Bridge_deck.png" },
      { source_page_url: "https://commons.wikimedia.org/wiki/File:Bridge_beams.png" },
      { source_page_url: "https://commons.wikimedia.org/wiki/File:Bridge_piers.png" },
    ],
  });

  assert.equal(verifyCalls, 2);
  assert.equal(findCalls, 0);
  assert.equal(fetchCalls, 1);
  assert.equal(prepared.length, 3);
  assert.equal(new Set(prepared.map((image) => image.download_url)).size, 1);
});

test("public image discovery bounds concurrent provider lookups", async () => {
  let active = 0;
  let maximumActive = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    publicImageProvider: {
      async find(request) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          download_url: `https://upload.wikimedia.org/${encodeURIComponent(request.query)}.png`,
          mime_type: "image/png",
          source_page_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(request.query)}.png`,
          license_name: "CC0 1.0",
          description: request.query,
        };
      },
    },
    fetchImpl: async () => new Response(PNG_BYTES, { headers: { "content-type": "image/png" } }),
  });
  const slides = Array.from({ length: 12 }, (_, index) => ({
    title: `Subject ${index}`,
    body: `Explanation ${index}`,
    imagePrompt: `subject ${index} diagram`,
  }));

  const prepared = await service.prepareForLesson({ topic: "Many subjects", audience: "general", slides });

  assert.equal(prepared.length, 12);
  assert.ok(maximumActive <= 1, `expected serialized lookups, saw ${maximumActive}`);
});

test("image discovery reuses a verified lesson visual after a provider rate limit", async () => {
  let findCalls = 0;
  let fetchCalls = 0;
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    lookupImpl: publicLookup,
    logger: { info() {} },
    publicImageProvider: {
      async find(request) {
        findCalls += 1;
        if (findCalls === 2) {
          const error = new Error("rate limited");
          error.status = 429;
          throw error;
        }
        return {
          download_url: "https://upload.wikimedia.org/verified-bridge.png",
          mime_type: "image/png",
          source_page_url: "https://commons.wikimedia.org/wiki/File:Verified_bridge.png",
          license_name: "CC0 1.0",
          description: request.query,
        };
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
    },
  });

  const prepared = await service.prepareForLesson({
    topic: "Bridge engineering",
    audience: "general learner",
    slides: [
      { title: "Deck", body: "The deck carries traffic.", imagePrompt: "bridge deck" },
      { title: "Beams", body: "Beams resist bending.", imagePrompt: "bridge beams" },
      { title: "Piers", body: "Piers carry loads downward.", imagePrompt: "bridge piers" },
    ],
  });

  assert.equal(findCalls, 2);
  assert.equal(fetchCalls, 1);
  assert.equal(prepared.length, 3);
  assert.equal(new Set(prepared.map((image) => image.download_url)).size, 1);
  assert.ok(prepared.every((image) => image.license_name === "CC0 1.0"));
});

test("image discovery stays atomic when rate limited before any visual is verified", async () => {
  let fetchCalls = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    publicImageProvider: {
      async find() {
        const error = new Error("rate limited");
        error.status = 429;
        throw error;
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
    },
  });

  await assert.rejects(service.prepareForLesson({
    topic: "Bridge engineering",
    audience: "general learner",
    slides: [{ title: "Deck", body: "The deck carries traffic.", imagePrompt: "bridge deck" }],
  }), /rate limited/i);
  assert.equal(fetchCalls, 0);
});

test("image discovery failure commits no staged lesson images", async () => {
  let finds = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    idFactory: () => "should-not-commit",
    publicImageProvider: {
      async find() {
        finds += 1;
        return finds >= 2 ? null : {
          download_url: "https://upload.wikimedia.org/usable.png",
          mime_type: "image/png",
          source_page_url: "https://commons.wikimedia.org/wiki/File:Usable.png",
          license_name: "CC0 1.0",
        };
      },
    },
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    }),
  });

  await assert.rejects(service.prepareForLesson({
    topic: "Test",
    audience: "general",
    slides: [
      { title: "One", body: "One", imagePrompt: "one" },
      { title: "Two", body: "Two", imagePrompt: "two" },
      { title: "Three", body: "Three", imagePrompt: "three" },
    ],
  }), /relevant public image/i);
  assert.equal(service.resolve("should-not-commit"), null);
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
    lookupImpl: async () => [
      { address: "2001:4860:4860::8844", family: 6 },
      { address: "8.8.4.4", family: 4 },
    ],
    dispatcherFactory: (url, records) => {
      dispatcherInput = { hostname: url.hostname, records };
      return pinned;
    },
    fetchImpl: async (_url, options) => {
      fetchDispatcher = options.dispatcher;
      return new Response(PNG_BYTES, {
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

test("image service rejects SVG bytes even when the response claims to be PNG", async () => {
  const disguisedSvg = `<?xml version="1.0"?><!--${"padding".repeat(100)}--><svg xmlns="http://www.w3.org/2000/svg"></svg>`;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new TextEncoder().encode(disguisedSvg), {
      headers: { "content-type": "image/png" },
    }),
  });

  await assert.rejects(
    service.prepareMany([{ download_url: "https://images.example/disguised.png" }]),
    /SVG.*not supported/i
  );
});

test("image service rejects a truncated PNG before narration can begin", async () => {
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      headers: { "content-type": "image/png" },
    }),
  });

  await assert.rejects(
    service.prepareMany([{ download_url: "https://images.example/truncated.png" }]),
    /invalid raster/i
  );
});

test("image service commits no cached assets when any lesson image fails", async () => {
  let fetchCalls = 0;
  const service = createLessonImageService({
    lookupImpl: publicLookup,
    idFactory: () => "staged-image",
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 2) throw new Error("second image failed");
      return new Response(PNG_BYTES, { headers: { "content-type": "image/png" } });
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
    fetchImpl: async () => new Response(PNG_BYTES, {
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
  assert.throws(
    () => createLessonImageService({ maxConcurrentSearches: 2 }),
    /serialized/i
  );
});

test("local PNG batch validation is atomic when the last member is malformed", () => {
  let nextId = 0;
  const service = createLessonImageService({ idFactory: () => `local-${++nextId}` });

  assert.throws(
    () => service.storePngBatch([localDiagramPng(), Buffer.from("not a PNG")]),
    /valid 1200x675 PNG/i
  );
  assert.equal(nextId, 0);
  assert.equal(service.resolve("local-1"), null);
});

test("local PNG batches reject the per-image and aggregate lesson byte limits", () => {
  const service = createLessonImageService();

  assert.throws(
    () => service.storePngBatch([localDiagramPng(5 * 1024 * 1024 + 1)]),
    /too large/i
  );
  assert.throws(
    () => service.storePngBatch(Array.from({ length: 5 }, () => localDiagramPng(4 * 1024 * 1024 + 1))),
    /too large/i
  );
});

test("local PNG batches expire together and own copies of caller buffers", () => {
  let currentTime = 10_000;
  const original = localDiagramPng();
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    assetTtlSeconds: 2,
    now: () => currentTime,
  });

  const [stored] = service.storePngBatch([original]);
  const id = new URL(stored.download_url).pathname.split("/").pop();
  original.fill(0);
  assert.equal(service.resolve(id).bytes[0], 0x89);
  currentTime += 2_000;
  assert.equal(service.resolve(id), null);
});

test("simultaneous local PNG users receive unique same-origin asset IDs without fetching", async () => {
  let fetchCalls = 0;
  const service = createLessonImageService({
    publicOrigin: "https://lesson.example",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("local PNG storage must not fetch");
    },
  });

  const batches = await Promise.all(Array.from({ length: 20 }, async () => (
    service.storePngBatch([localDiagramPng(), localDiagramPng()])
  )));
  const stored = batches.flat();
  const urls = stored.map((asset) => asset.download_url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => url.startsWith("https://lesson.example/api/images/")));
  assert.ok(stored.every((asset) => asset.mime_type === "image/png"));
  assert.equal(fetchCalls, 0);
});

test("a successful local PNG batch remains resolvable with PNG metadata", () => {
  const service = createLessonImageService({ publicOrigin: "https://lesson.example" });

  const stored = service.storePngBatch([localDiagramPng(), localDiagramPng()]);

  assert.notEqual(stored[0].download_url, stored[1].download_url);
  assert.deepEqual(Object.keys(stored[0]).sort(), ["download_url", "file_name", "mime_type", "size"]);
  assert.deepEqual(stored.map(({ mime_type, file_name, size }) => ({ mime_type, file_name, size })), [
    { mime_type: "image/png", file_name: "lesson-diagram-1.png", size: PNG_BYTES.byteLength },
    { mime_type: "image/png", file_name: "lesson-diagram-2.png", size: PNG_BYTES.byteLength },
  ]);
  for (const asset of stored) {
    const id = new URL(asset.download_url).pathname.split("/").pop();
    assert.deepEqual(service.resolve(id).bytes, localDiagramPng());
  }
});

test("cache pressure evicts older assets without splitting the newly admitted local batch", () => {
  let nextId = 0;
  const imageSize = localDiagramPng().byteLength;
  const service = createLessonImageService({
    maxCacheBytes: imageSize * 2,
    idFactory: () => `asset-${++nextId}`,
  });
  const [oldAsset] = service.storePngBatch([localDiagramPng()]);

  const newBatch = service.storePngBatch([localDiagramPng(), localDiagramPng()]);

  const oldId = new URL(oldAsset.download_url).pathname.split("/").pop();
  assert.equal(service.resolve(oldId), null);
  assert.ok(newBatch.every(({ download_url }) => {
    const id = new URL(download_url).pathname.split("/").pop();
    return service.resolve(id) !== null;
  }));
});
