import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(address) {
  const normalized = String(address).toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateAddress(normalized.slice("::ffff:".length));
  }
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}

async function assertPublicHttpsUrl(value, lookupImpl) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Lesson image URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Lesson image URL must not contain credentials.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Lesson image host is not allowed.");
  }
  const records = await lookupImpl(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("Lesson image host is not publicly reachable.");
  }
  return url;
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
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  lookupImpl = lookup,
  now = Date.now,
} = {}) {
  const origin = publicOrigin.replace(/\/+$/, "");
  const assets = new Map();

  function prune() {
    const current = now();
    for (const [id, asset] of assets) {
      if (asset.expiresAt <= current) assets.delete(id);
    }
    while (assets.size > 64) assets.delete(assets.keys().next().value);
  }

  async function fetchImage(sourceUrl) {
    let current = await assertPublicHttpsUrl(sourceUrl, lookupImpl);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
            "user-agent": "AskLilOwl/0.3 image proxy",
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount === maxRedirects) throw new Error("Lesson image redirected too many times.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Lesson image redirect was invalid.");
        current = await assertPublicHttpsUrl(new URL(location, current).href, lookupImpl);
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
    }
    throw new Error("Lesson image could not be fetched.");
  }

  async function prepareOne(image, index) {
    const sourceUrl = image?.download_url;
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) return image;
    const { bytes, contentType } = await fetchImage(sourceUrl.trim());
    prune();
    const id = randomUUID();
    const expiresAt = now() + assetTtlSeconds * 1_000;
    assets.set(id, { bytes, contentType, expiresAt });
    return {
      ...image,
      download_url: `${origin}/api/images/${id}`,
      mime_type: contentType,
      file_name: image.file_name ?? `lesson-image-${index + 1}`,
    };
  }

  async function prepareMany(images = []) {
    return Promise.all(images.map((image, index) => prepareOne(image, index)));
  }

  function resolve(id) {
    prune();
    const asset = assets.get(String(id));
    if (!asset || asset.expiresAt <= now()) return null;
    return asset;
  }

  return { prepareMany, resolve };
}
