import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { buildVisualRequest, isAllowedPublicLicense } from "./public-images.js";

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LESSON_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 4;
const DEFAULT_MAX_CONCURRENT_SEARCHES = 2;
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

function preferredConnectionRecords(records) {
  const ipv4 = records.filter((record) => record.family === 4);
  return ipv4.length ? ipv4 : [...records];
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

function hasRasterSignature(bytes, contentType) {
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) return false;
    const ascii = new TextDecoder("ascii");
    const hasIhdr = bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13 &&
      ascii.decode(bytes.subarray(12, 16)) === "IHDR";
    const end = bytes.length - 12;
    const hasIend = bytes[end] === 0 && bytes[end + 1] === 0 && bytes[end + 2] === 0 && bytes[end + 3] === 0 &&
      ascii.decode(bytes.subarray(end + 4, end + 8)) === "IEND";
    return hasIhdr && hasIend;
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (contentType === "image/gif") {
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
    return bytes.length >= 14 && (header === "GIF87a" || header === "GIF89a") && bytes[bytes.length - 1] === 0x3b;
  }
  if (contentType === "image/webp") {
    const declaredSize = bytes.length >= 8 ? new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) : 0;
    return bytes.length >= 20 && declaredSize + 8 <= bytes.length &&
      new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP";
  }
  if (contentType === "image/avif") {
    if (bytes.length < 16 || new TextDecoder("ascii").decode(bytes.subarray(4, 8)) !== "ftyp") return false;
    const brand = new TextDecoder("ascii").decode(bytes.subarray(8, Math.min(bytes.length, 32)));
    return /avif|avis/.test(brand);
  }
  return false;
}

export function createLessonImageService({
  publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com",
  assetTtlSeconds = Number(process.env.LESSON_IMAGE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS),
  maxImageBytes = Number(process.env.LESSON_IMAGE_MAX_BYTES ?? DEFAULT_MAX_IMAGE_BYTES),
  maxLessonImageBytes = Number(process.env.LESSON_IMAGE_TOTAL_MAX_BYTES ?? DEFAULT_MAX_LESSON_IMAGE_BYTES),
  maxCacheBytes = Number(process.env.LESSON_IMAGE_CACHE_MAX_BYTES ?? DEFAULT_MAX_CACHE_BYTES),
  maxConcurrentDownloads = DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  maxConcurrentSearches = DEFAULT_MAX_CONCURRENT_SEARCHES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = undiciFetch,
  lookupImpl = lookup,
  dispatcherFactory = createPinnedDispatcher,
  idFactory = randomUUID,
  now = Date.now,
  publicImageProvider = null,
} = {}) {
  const origin = publicOrigin.replace(/\/+$/, "");
  requirePositiveNumber("assetTtlSeconds", assetTtlSeconds);
  requirePositiveNumber("maxImageBytes", maxImageBytes);
  requirePositiveNumber("maxLessonImageBytes", maxLessonImageBytes);
  requirePositiveNumber("maxCacheBytes", maxCacheBytes);
  requirePositiveNumber("maxConcurrentDownloads", maxConcurrentDownloads, { integer: true });
  requirePositiveNumber("maxConcurrentSearches", maxConcurrentSearches, { integer: true });
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
      const dispatcher = dispatcherFactory(target.url, preferredConnectionRecords(target.records));
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
        if (!hasRasterSignature(bytes, contentType)) {
          throw new Error("SVG or invalid raster lesson image bytes are not supported.");
        }
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

  async function prepareForLesson({ topic = "", audience = "", slides = [], images = [] } = {}) {
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new Error("Lesson slides are required before images can be prepared.");
    }
    const supplied = Array.isArray(images) ? images : [];
    const selected = new Array(slides.length);
    let nextSearchIndex = 0;
    let searchFailure = null;
    async function searchWorker() {
      while (!searchFailure && nextSearchIndex < slides.length) {
        const index = nextSearchIndex;
        nextSearchIndex += 1;
        try {
          const candidate = supplied[index];
          if (!publicImageProvider?.find) {
            if (candidate?.download_url || candidate?.file_id) {
              selected[index] = candidate;
              continue;
            }
            throw new Error("A relevant public image was not available for every slide.");
          }
          const request = buildVisualRequest({ topic, audience, slide: slides[index] });
          let found = candidate && typeof publicImageProvider.verify === "function"
            ? await publicImageProvider.verify(candidate, request)
            : null;
          if (!found) found = await publicImageProvider.find(request);
          if (!found || !isAllowedPublicLicense(found)) {
            throw new Error("A relevant public image was not available for every slide.");
          }
          selected[index] = found;
        } catch (error) {
          searchFailure ??= error;
        }
      }
    }
    const searchWorkerCount = Math.max(1, Math.min(maxConcurrentSearches, slides.length));
    await Promise.all(Array.from({ length: searchWorkerCount }, () => searchWorker()));
    if (searchFailure) throw searchFailure;
    return prepareMany(selected);
  }

  function resolve(id) {
    prune();
    const asset = assets.get(String(id));
    if (!asset || asset.expiresAt <= now()) return null;
    return asset;
  }

  return { prepareMany, prepareForLesson, resolve };
}
