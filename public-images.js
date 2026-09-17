import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const SEARCH_RESULT_LIMIT = 12;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SEARCH_STOP_WORDS = new Set([
  "and", "are", "diagram", "educational", "for", "from", "how", "illustration", "image",
  "into", "its", "labeled", "simple", "showing", "that", "the", "this", "visual", "with",
]);
const INDIRECT_VISUAL_TERMS = ["building", "decorative", "ornament", "logo", "icon", "pattern", "road sign", "stop sign"];

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return new Set(
    cleanText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !SEARCH_STOP_WORDS.has(word))
  );
}

function overlapScore(expected, actual) {
  let score = 0;
  for (const word of expected) if (actual.has(word)) score += 1;
  return score;
}

export function buildVisualRequest({ topic = "", audience = "", slide = {} } = {}) {
  const imagePrompt = cleanText(slide.imagePrompt);
  const title = cleanText(slide.title);
  const body = cleanText(slide.body);
  const normalizedTopic = cleanText(topic);
  const query = imagePrompt || [title, normalizedTopic].filter(Boolean).join(" ");
  const teachingText = `${imagePrompt} ${title} ${body}`;
  return {
    query,
    context: [normalizedTopic, title, body].filter(Boolean).join(" "),
    audience: cleanText(audience),
    visualKind: /diagram|label|divide|divided|triangle|graph|chart|map|cross.?section|anatom/i.test(teachingText)
      ? "diagram"
      : "subject",
  };
}

export function isAllowedPublicLicense(candidate = {}) {
  const license = cleanText(candidate.licenseName ?? candidate.license_name).toLowerCase();
  if (!license || /non.?commercial|\bnc\b|no.?derivatives|\bnd\b|fair use|unknown/.test(license)) {
    return false;
  }
  if (/public domain|\bcc0\b|creative commons zero/.test(license)) return true;
  const match = license.match(/\bcc\s*by(?:-sa)?\s*(\d(?:\.\d)?)/);
  return Boolean(match && Number(match[1]) >= 2);
}

function candidateLexicalScore(request, candidate) {
  const queryWords = words(request.query);
  const contextWords = words(request.context);
  const titleWords = words(candidate.title);
  const descriptionWords = words(candidate.description);
  const combinedWords = new Set([...titleWords, ...descriptionWords]);
  let score = overlapScore(queryWords, titleWords) * 8;
  score += overlapScore(queryWords, descriptionWords) * 4;
  score += overlapScore(contextWords, combinedWords) * 2;
  return score;
}

function candidateMatchCount(request, candidate) {
  const expected = words(`${request.query} ${request.context}`);
  const actual = words(`${candidate.title} ${candidate.description}`);
  return overlapScore(expected, actual);
}

function hasRequiredRelevance(request, candidate) {
  const requested = cleanText(`${request.query} ${request.context}`).toLowerCase();
  const candidateText = cleanText(`${candidate.title} ${candidate.description}`).toLowerCase();
  if (INDIRECT_VISUAL_TERMS.some((term) => candidateText.includes(term) && !requested.includes(term))) {
    return false;
  }
  const meaningfulQueryWords = words(request.query).size;
  const requiredMatches = Math.min(2, Math.max(1, meaningfulQueryWords));
  return candidateMatchCount(request, candidate) >= requiredMatches;
}

function searchQueries(request) {
  const meaningful = [...words(request.query)];
  const coreWithQualifier = [...meaningful.slice(0, 2), meaningful.at(-1)].filter(Boolean).join(" ");
  return [...new Set([
    cleanText(request.query),
    coreWithQualifier,
    meaningful.slice(0, 2).join(" "),
  ].filter(Boolean))];
}

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

async function readBoundedJson(response, maximumBytes = MAX_API_RESPONSE_BYTES) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("Public image search response was too large.");
  }
  if (!response.body) throw new Error("Public image search response was empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Public image search response was too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Public image search returned invalid data.");
  }
}

function candidateScore(request, candidate) {
  let score = candidateLexicalScore(request, candidate);
  if (request.visualKind === "diagram" && /diagram|dissection|divid|triangle|label|geometry|apothem/i.test(`${candidate.title} ${candidate.description}`)) {
    score += 10;
  }
  if (/decorative|building|ornament|logo|icon|pattern/i.test(`${candidate.title} ${candidate.description}`)) {
    score -= 8;
  }
  const pixels = Number(candidate.width ?? 0) * Number(candidate.height ?? 0);
  if (pixels >= 480 * 480) score += 1;
  return score;
}

export function rankPublicImageCandidates(request, candidates = []) {
  return candidates
    .map((candidate) => ({ candidate, score: candidateScore(request, candidate) }))
    .sort((left, right) =>
      right.score - left.score ||
      Number(left.candidate.position ?? 0) - Number(right.candidate.position ?? 0)
    )
    .map(({ candidate }) => candidate);
}

function metadataValue(metadata, key) {
  return cleanText(metadata?.[key]?.value);
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeWikimediaCandidate(page, position = 0) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const metadata = info.extmetadata ?? {};
  const originalMime = cleanText(info.mime).toLowerCase();
  const isSvg = originalMime === "image/svg+xml";
  const rasterUrl = safeHttps(isSvg ? info.thumburl : (info.thumburl ?? info.url));
  const mimeType = isSvg ? "image/png" : originalMime;
  const licenseName = metadataValue(metadata, "LicenseShortName") || metadataValue(metadata, "UsageTerms");
  const candidate = {
    title: cleanText(page.title).replace(/^File:/i, ""),
    description: metadataValue(metadata, "ImageDescription") || metadataValue(metadata, "ObjectName"),
    download_url: rasterUrl,
    mime_type: mimeType,
    file_name: cleanText(page.title).replace(/^File:/i, "") || `wikimedia-image-${position + 1}`,
    source_page_url: safeHttps(info.descriptionurl),
    creator: metadataValue(metadata, "Artist") || metadataValue(metadata, "Credit"),
    license_name: licenseName,
    license_url: safeHttps(metadataValue(metadata, "LicenseUrl")),
    source_organization: "Wikimedia Commons",
    width: Number(info.thumbwidth ?? info.width ?? 0),
    height: Number(info.thumbheight ?? info.height ?? 0),
    position,
  };
  if (!candidate.download_url || !candidate.source_page_url || !RASTER_TYPES.has(candidate.mime_type)) return null;
  return candidate;
}

export function createWikimediaImageProvider({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
  lookupImpl = lookup,
  dispatcherFactory = createPinnedDispatcher,
} = {}) {
  async function find(request) {
    const startedAt = Date.now();
    const queryHash = createHash("sha256").update(String(request.query ?? "")).digest("hex").slice(0, 12);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let dispatcher;
    try {
      const apiUrl = new URL(WIKIMEDIA_API);
      const records = await withTimeout(
        lookupImpl(apiUrl.hostname, { all: true, verbatim: true }),
        timeoutMs,
        "Public image search host lookup timed out."
      );
      if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
        throw new Error("Public image search host is not publicly reachable.");
      }
      dispatcher = dispatcherFactory(apiUrl, records);
      const candidates = [];
      const seenSources = new Set();
      const rejectionCounts = { unsupported: 0, restrictedLicense: 0, unrelated: 0 };
      let selected = null;
      let attemptCount = 0;
      for (const query of searchQueries(request)) {
        attemptCount += 1;
        const url = new URL(WIKIMEDIA_API);
        url.search = new URLSearchParams({
          action: "query",
          format: "json",
          formatversion: "2",
          generator: "search",
          gsrnamespace: "6",
          gsrsearch: query,
          gsrlimit: String(SEARCH_RESULT_LIMIT),
          prop: "imageinfo",
          iiprop: "url|mime|size|extmetadata",
          iiurlwidth: "1200",
          origin: "*",
        }).toString();
        const response = await fetchImpl(url, {
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "AskLilOwl/0.4 educational image search" },
        });
        if (!response.ok) {
          const error = new Error("Public image search was unavailable.");
          error.status = response.status;
          throw error;
        }
        const payload = await readBoundedJson(response);
        const pages = Array.isArray(payload?.query?.pages)
          ? payload.query.pages
          : Object.values(payload?.query?.pages ?? {});
        for (const page of pages) {
          const candidate = normalizeWikimediaCandidate(page, candidates.length);
          if (!candidate) {
            rejectionCounts.unsupported += 1;
            continue;
          }
          if (!isAllowedPublicLicense(candidate)) {
            rejectionCounts.restrictedLicense += 1;
            continue;
          }
          if (seenSources.has(candidate.source_page_url)) continue;
          seenSources.add(candidate.source_page_url);
          candidates.push(candidate);
        }
        const ranked = rankPublicImageCandidates(request, candidates);
        selected = ranked.find((candidate) => hasRequiredRelevance(request, candidate)) ?? null;
        if (selected) break;
      }
      rejectionCounts.unrelated = candidates.filter((candidate) => !hasRequiredRelevance(request, candidate)).length;
      logger.info?.({
        event: "public_image_search_completed",
        provider: "wikimedia_commons",
        queryHash,
        attemptCount,
        candidateCount: candidates.length,
        rejectionCounts,
        selectedLicense: selected?.license_name ?? null,
        selectedFormat: selected?.mime_type ?? null,
        rasterizedFromSvg: Boolean(selected && /\.svg$/i.test(selected.file_name)),
        sourceKind: "public_search",
        durationMs: Date.now() - startedAt,
      });
      return selected;
    } catch (error) {
      logger.error?.({
        event: "public_image_search_failed",
        provider: "wikimedia_commons",
        queryHash,
        errorName: typeof error?.name === "string" ? error.name : "Error",
        status: Number.isSafeInteger(error?.status) ? error.status : null,
        code: typeof error?.code === "string" ? error.code : null,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      if (typeof dispatcher?.destroy === "function") await dispatcher.destroy();
      else await dispatcher?.close?.();
    }
  }

  async function verify(candidate, request) {
    let source;
    try {
      source = new URL(candidate?.source_page_url);
    } catch {
      return null;
    }
    if (source.protocol !== "https:" || source.hostname !== "commons.wikimedia.org" || !source.pathname.startsWith("/wiki/File:")) {
      return null;
    }
    let title;
    try {
      title = decodeURIComponent(source.pathname.slice("/wiki/".length)).replaceAll("_", " ");
    } catch {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let dispatcher;
    try {
      const apiUrl = new URL(WIKIMEDIA_API);
      const records = await withTimeout(
        lookupImpl(apiUrl.hostname, { all: true, verbatim: true }),
        timeoutMs,
        "Public image search host lookup timed out."
      );
      if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
        throw new Error("Public image search host is not publicly reachable.");
      }
      dispatcher = dispatcherFactory(apiUrl, records);
      apiUrl.search = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        titles: title,
        prop: "imageinfo",
        iiprop: "url|mime|size|extmetadata",
        iiurlwidth: "1200",
        origin: "*",
      }).toString();
      const response = await fetchImpl(apiUrl, {
        dispatcher,
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "AskLilOwl/0.4 educational image search" },
      });
      if (!response.ok) throw new Error("Public image verification was unavailable.");
      const payload = await readBoundedJson(response);
      const pages = Array.isArray(payload?.query?.pages)
        ? payload.query.pages
        : Object.values(payload?.query?.pages ?? {});
      const verified = normalizeWikimediaCandidate(pages[0], 0);
      return verified && isAllowedPublicLicense(verified) && hasRequiredRelevance(request, verified)
        ? verified
        : null;
    } finally {
      clearTimeout(timeout);
      if (typeof dispatcher?.destroy === "function") await dispatcher.destroy();
      else await dispatcher?.close?.();
    }
  }

  return { find, verify };
}
