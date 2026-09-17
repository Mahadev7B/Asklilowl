import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LESSON_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 4;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function isPublicAddress(address) {
  try {
    return ipaddr.process(String(address)).range() === "unicast";
  } catch {
    return false;
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPublicHttpsUrl(value, lookupImpl, timeoutMs) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Lesson image URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Lesson image URL must not contain credentials.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Lesson image host is not allowed.");
  }
  const records = await withTimeout(
    lookupImpl(hostname, { all: true, verbatim: true }),
    timeoutMs,
    "Lesson image host lookup timed out."
  );
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("Lesson image host is not publicly reachable.");
  }
  return { url, records };
}

function createPinnedDispatcher(url, records) {
  let next = 0;
  return new Agent({
    connect: {
      servername: url.hostname,
      lookup(_hostname, options, callback) {
        if (options?.all) {
          callback(null, records.map(({ address, family }) => ({ address, family })));
          return;
        }
        const record = records[next % records.length];
        next += 1;
        callback(null, record.address, record.family);
      },
    },
  });
}

function requirePositiveNumber(name, value, { integer = false } = {}) {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${name} must be a finite positive${integer ? " integer" : " number"}.`);
  }
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Lesson image is too large.");
  }
  if (!response.body) throw new Error("Lesson image response was empty.");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Lesson image is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createLessonImageService({
  publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com",
  assetTtlSeconds = Number(process.env.LESSON_IMAGE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS),
  maxImageBytes = Number(process.env.LESSON_IMAGE_MAX_BYTES ?? DEFAULT_MAX_IMAGE_BYTES),
  maxLessonImageBytes = Number(process.env.LESSON_IMAGE_TOTAL_MAX_BYTES ?? DEFAULT_MAX_LESSON_IMAGE_BYTES),
  maxCacheBytes = Number(process.env.LESSON_IMAGE_CACHE_MAX_BYTES ?? DEFAULT_MAX_CACHE_BYTES),
  maxConcurrentDownloads = DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  lookupImpl = lookup,
  dispatcherFactory = createPinnedDispatcher,
  idFactory = randomUUID,
  now = Date.now,
} = {}) {
  const origin = publicOrigin.replace(/\/+$/, "");
  requirePositiveNumber("assetTtlSeconds", assetTtlSeconds);
  requirePositiveNumber("maxImageBytes", maxImageBytes);
  requirePositiveNumber("maxLessonImageBytes", maxLessonImageBytes);
  requirePositiveNumber("maxCacheBytes", maxCacheBytes);
  requirePositiveNumber("maxConcurrentDownloads", maxConcurrentDownloads, { integer: true });
  requirePositiveNumber("timeoutMs", timeoutMs);
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("maxRedirects must be a finite non-negative integer.");
  }
  const assets = new Map();

  function prune() {
    const current = now();
    let cachedBytes = 0;
    for (const [id, asset] of assets) {
      if (asset.expiresAt <= current) assets.delete(id);
      else cachedBytes += asset.bytes.length;
    }
    while (assets.size > 64 || cachedBytes > maxCacheBytes) {
      const oldestId = assets.keys().next().value;
      const oldest = assets.get(oldestId);
      assets.delete(oldestId);
      cachedBytes -= oldest?.bytes.length ?? 0;
    }
  }

  async function fetchImage(sourceUrl) {
    let target = await assertPublicHttpsUrl(sourceUrl, lookupImpl, timeoutMs);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const dispatcher = dispatcherFactory(target.url, target.records);
      try {
        const response = await fetchImpl(target.url, {
          redirect: "manual",
          signal: controller.signal,
          dispatcher,
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
            "user-agent": "AskLilOwl/0.3 image proxy",
          },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirectCount === maxRedirects) throw new Error("Lesson image redirected too many times.");
          const location = response.headers.get("location");
          if (!location) throw new Error("Lesson image redirect was invalid.");
          await response.body?.cancel().catch(() => {});
          target = await assertPublicHttpsUrl(new URL(location, target.url).href, lookupImpl, timeoutMs);
          continue;
        }

        if (!response.ok) throw new Error("Lesson image could not be fetched.");
        const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
          throw new Error("Lesson image response was not a supported raster image.");
        }
        const bytes = await readBoundedBody(response, maxImageBytes);
        if (!bytes.length) throw new Error("Lesson image response was empty.");
        return { bytes, contentType };
      } finally {
        clearTimeout(timeout);
        if (typeof dispatcher?.destroy === "function") await dispatcher.destroy();
        else await dispatcher?.close?.();
      }
    }
    throw new Error("Lesson image could not be fetched.");
  }

  async function stageOne(image, index) {
    const sourceUrl = image?.download_url;
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) return { image, asset: null };
    const { bytes, contentType } = await fetchImage(sourceUrl.trim());
    const id = idFactory();
    const expiresAt = now() + assetTtlSeconds * 1_000;
    return {
      image: {
        ...image,
        download_url: `${origin}/api/images/${id}`,
        mime_type: contentType,
        file_name: image.file_name ?? `lesson-image-${index + 1}`,
      },
      asset: { id, bytes, contentType, expiresAt },
    };
  }

  async function prepareMany(images = []) {
    const staged = new Array(images.length);
    let nextIndex = 0;
    let totalBytes = 0;
    let failure = null;
    async function worker() {
      while (!failure && nextIndex < images.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          const item = await stageOne(images[index], index);
          totalBytes += item.asset?.bytes.length ?? 0;
          if (totalBytes > maxLessonImageBytes) {
            throw new Error("Lesson images are too large.");
          }
          staged[index] = item;
        } catch (error) {
          failure ??= error;
        }
      }
    }
    const workerCount = Math.max(1, Math.min(maxConcurrentDownloads, images.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (failure) throw failure;

    prune();
    for (const item of staged) {
      if (item.asset) {
        const { id, ...asset } = item.asset;
        assets.set(id, asset);
      }
    }
    prune();
    return staged.map((item) => item.image);
  }

  function resolve(id) {
    prune();
    const asset = assets.get(String(id));
    if (!asset || asset.expiresAt <= now()) return null;
    return asset;
  }

  return { prepareMany, resolve };
}
