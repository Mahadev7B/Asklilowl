import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisualRequest,
  createWikimediaImageProvider,
  isAllowedPublicLicense,
  rankPublicImageCandidates,
} from "../public-images.js";

const visualInput = {
  topic: "How to calculate the area of a regular octagon",
  audience: "general learner",
  slide: {
    title: "Eight equal triangles",
    body: "Divide the regular octagon into eight equal triangles.",
    imagePrompt: "regular octagon divided into eight equal triangles",
  },
};
const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];

test("visual requests keep the concrete teaching subject", () => {
  const request = buildVisualRequest(visualInput);

  assert.equal(request.query, "regular octagon divided into eight equal triangles");
  assert.equal(request.visualKind, "diagram");
  assert.match(request.context, /area of a regular octagon/i);
});

test("common-sense subject relevance outranks an indirect raster photograph", () => {
  const request = buildVisualRequest(visualInput);
  const ranked = rankPublicImageCandidates(request, [
    {
      title: "Octagonal building photograph",
      description: "A decorative building with eight sides",
      mimeType: "image/jpeg",
      width: 2400,
      height: 1600,
      position: 0,
    },
    {
      title: "Regular octagon divided into eight triangles",
      description: "Educational geometry diagram",
      mimeType: "image/png",
      width: 960,
      height: 960,
      position: 1,
    },
  ]);

  assert.equal(ranked[0].title, "Regular octagon divided into eight triangles");
});

test("commercial-safe public licenses pass and restricted licenses fail", () => {
  for (const licenseName of ["Public domain", "CC0 1.0", "CC BY 4.0", "CC BY-SA 3.0"]) {
    assert.equal(isAllowedPublicLicense({ licenseName }), true, licenseName);
  }
  for (const licenseName of ["CC BY-NC-SA 4.0", "CC BY-ND 4.0", "Fair use", "Unknown"]) {
    assert.equal(isAllowedPublicLicense({ licenseName }), false, licenseName);
  }
});

test("Wikimedia provider returns an attributed PNG preview for a relevant SVG", async () => {
  const fixture = {
    query: {
      pages: {
        7: {
          title: "File:Octagonal building.jpg",
          imageinfo: [{
            mime: "image/jpeg",
            width: 2400,
            height: 1600,
            thumburl: "https://upload.wikimedia.org/building.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Octagonal_building.jpg",
            extmetadata: {
              LicenseShortName: { value: "CC0 1.0" },
              Artist: { value: "Example photographer" },
              ImageDescription: { value: "An octagonal building" },
            },
          }],
        },
        8: {
          title: "File:Regular octagon isosceles dissection.svg",
          imageinfo: [{
            mime: "image/svg+xml",
            width: 1000,
            height: 1000,
            url: "https://upload.wikimedia.org/octagon.svg",
            thumburl: "https://upload.wikimedia.org/octagon-preview.png",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Regular_octagon_isosceles_dissection.svg",
            extmetadata: {
              LicenseShortName: { value: "CC0 1.0" },
              LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" },
              Artist: { value: "Geometry Teacher" },
              ImageDescription: { value: "Regular octagon divided into eight equal triangles" },
            },
          }],
        },
      },
    },
  };
  const requestedUrls = [];
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return Response.json(fixture);
    },
  });

  const result = await provider.find(buildVisualRequest(visualInput));

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /generator=search/);
  assert.equal(result.download_url, "https://upload.wikimedia.org/octagon-preview.png");
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.creator, "Geometry Teacher");
  assert.equal(result.license_name, "CC0 1.0");
  assert.equal(result.source_organization, "Wikimedia Commons");
});

test("Wikimedia provider retries a temporary 429 before rejecting the slide image", async () => {
  let fetchCalls = 0;
  const waits = [];
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    sleepImpl: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response("rate limited", { status: 429, headers: { "retry-after": "1" } });
      }
      return Response.json({
        query: {
          pages: [{
            title: "File:Regular octagon diagram.png",
            imageinfo: [{
              mime: "image/png",
              thumburl: "https://upload.wikimedia.org/regular-octagon.png",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Regular_octagon_diagram.png",
              extmetadata: {
                LicenseShortName: { value: "CC0 1.0" },
                ImageDescription: { value: "Regular octagon divided into eight equal triangles" },
              },
            }],
          }],
        },
      });
    },
  });

  const result = await provider.find(buildVisualRequest(visualInput));

  assert.equal(fetchCalls, 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.download_url, "https://upload.wikimedia.org/regular-octagon.png");
});

test("Wikimedia provider falls back from a verbose prompt to its core subject", async () => {
  const queries = [];
  const events = [];
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    logger: { info: (event) => events.push(event) },
    fetchImpl: async (url) => {
      const query = new URL(url).searchParams.get("gsrsearch");
      queries.push(query);
      if (query !== "regular octagon") return Response.json({ query: { pages: [] } });
      return Response.json({
        query: {
          pages: [{
            title: "File:Regular octagon.svg",
            imageinfo: [{
              mime: "image/svg+xml",
              thumburl: "https://upload.wikimedia.org/regular-octagon.png",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Regular_octagon.svg",
              extmetadata: {
                LicenseShortName: { value: "CC0 1.0" },
                ImageDescription: { value: "Regular octagon geometry diagram" },
              },
            }],
          }],
        },
      });
    },
  });

  const result = await provider.find(buildVisualRequest({
    topic: "Area of a regular octagon",
    audience: "general learner",
    slide: {
      title: "The apothem",
      body: "The apothem reaches from the center to a side.",
      imagePrompt: "regular octagon apothem geometry diagram",
    },
  }));

  assert.deepEqual(queries, [
    "regular octagon apothem geometry diagram",
    "regular octagon geometry",
    "regular octagon",
  ]);
  assert.equal(result.title, "Regular octagon.svg");
  assert.equal(result.mime_type, "image/png");
  assert.equal(events[0].attemptCount, 3);
  assert.match(events[0].queryHash, /^[a-f0-9]{12}$/);
  assert.equal(events[0].rasterizedFromSvg, true);
  assert.equal(events[0].sourceKind, "public_search");
  assert.ok(events[0].durationMs >= 0);
});

test("Wikimedia provider returns null when every result has a restricted license", async () => {
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async () => Response.json({
      query: {
        pages: {
          1: {
            title: "File:Restricted.svg",
            imageinfo: [{
              mime: "image/svg+xml",
              thumburl: "https://upload.wikimedia.org/restricted.png",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Restricted.svg",
              extmetadata: { LicenseShortName: { value: "CC BY-NC-SA 4.0" } },
            }],
          },
        },
      },
    }),
  });

  assert.equal(await provider.find(buildVisualRequest(visualInput)), null);
});

test("Wikimedia provider refuses an indirect building photo that only shares the subject shape", async () => {
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async () => Response.json({
      query: {
        pages: [{
          title: "File:Regular octagon building photograph.jpg",
          imageinfo: [{
            mime: "image/jpeg",
            thumburl: "https://upload.wikimedia.org/octagon-building.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Regular_octagon_building_photograph.jpg",
            extmetadata: {
              LicenseShortName: { value: "CC BY 4.0" },
              ImageDescription: { value: "A decorative building with a regular octagonal floor plan" },
            },
          }],
        }],
      },
    }),
  });

  assert.equal(await provider.find(buildVisualRequest(visualInput)), null);
});

test("Wikimedia provider rejects private DNS answers before fetching", async () => {
  let fetchCalls = 0;
  const provider = createWikimediaImageProvider({
    lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({ query: { pages: [] } });
    },
  });

  await assert.rejects(provider.find(buildVisualRequest(visualInput)), /not publicly reachable/i);
  assert.equal(fetchCalls, 0);
});

test("Wikimedia provider pins to validated IPv4 when DNS returns both families", async () => {
  let dispatcherRecords;
  const provider = createWikimediaImageProvider({
    lookupImpl: async () => [
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ],
    dispatcherFactory: (_url, records) => {
      dispatcherRecords = records;
      return { destroy: async () => {} };
    },
    fetchImpl: async () => Response.json({ query: { pages: [] } }),
  });

  await provider.find(buildVisualRequest(visualInput));

  assert.deepEqual(dispatcherRecords, [{ address: "8.8.8.8", family: 4 }]);
});

test("Wikimedia provider rejects oversized API responses", async () => {
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "3000000" },
    }),
  });

  await assert.rejects(provider.find(buildVisualRequest(visualInput)), /response was too large/i);
});

test("Wikimedia provider logs a sanitized search failure without the query or URL", async () => {
  const events = [];
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    logger: { error: (event) => events.push(event) },
    fetchImpl: async () => new Response("blocked", { status: 429 }),
  });

  await assert.rejects(provider.find(buildVisualRequest(visualInput)), /unavailable/i);

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "public_image_search_failed");
  assert.equal(events[0].status, 429);
  assert.equal(typeof events[0].queryHash, "string");
  assert.equal("query" in events[0], false);
  assert.equal("url" in events[0], false);
});

test("Wikimedia provider logs sanitized nested network error codes", async () => {
  const events = [];
  const networkError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
  });
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    logger: { error: (event) => events.push(event) },
    fetchImpl: async () => { throw networkError; },
  });

  await assert.rejects(provider.find(buildVisualRequest(visualInput)), /fetch failed/i);

  assert.equal(events[0].causeName, "Error");
  assert.equal(events[0].causeCode, "ECONNREFUSED");
  assert.deepEqual(events[0].nestedCodes, []);
  assert.equal(JSON.stringify(events[0]).includes("connection refused"), false);
});

test("Wikimedia provider revalidates a supplied Commons candidate from official metadata", async () => {
  const requestedUrls = [];
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      requestedUrls.push(new URL(url));
      return Response.json({
        query: {
          pages: [{
            title: "File:Regular octagon isosceles dissection.svg",
            imageinfo: [{
              mime: "image/svg+xml",
              thumburl: "https://upload.wikimedia.org/verified-octagon.png",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Regular_octagon_isosceles_dissection.svg",
              extmetadata: {
                LicenseShortName: { value: "CC0 1.0" },
                ImageDescription: { value: "Regular octagon divided into equal triangles" },
              },
            }],
          }],
        },
      });
    },
  });

  const verified = await provider.verify({
    download_url: "https://untrusted.example/not-used.png",
    source_page_url: "https://commons.wikimedia.org/wiki/File:Regular_octagon_isosceles_dissection.svg",
    license_name: "Self declared",
  }, buildVisualRequest(visualInput));

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].searchParams.get("titles"), "File:Regular octagon isosceles dissection.svg");
  assert.equal(verified.download_url, "https://upload.wikimedia.org/verified-octagon.png");
  assert.equal(verified.license_name, "CC0 1.0");
});

test("Wikimedia verification treats malformed encoded source titles as unsuitable", async () => {
  let fetchCalls = 0;
  const provider = createWikimediaImageProvider({
    lookupImpl: publicLookup,
    fetchImpl: async () => {
      fetchCalls += 1;
      return Response.json({ query: { pages: [] } });
    },
  });

  const verified = await provider.verify({
    source_page_url: "https://commons.wikimedia.org/wiki/File:%E0%A4%A",
  }, buildVisualRequest(visualInput));

  assert.equal(verified, null);
  assert.equal(fetchCalls, 0);
});
