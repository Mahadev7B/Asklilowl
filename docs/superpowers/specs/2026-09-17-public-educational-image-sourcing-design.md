# Relevance-First Public Educational Image Sourcing

## Purpose

AskLilOwl must produce complete lessons with one clear visual per slide without depending on paid image generation or the currently unreliable ChatGPT-native image-file handoff. The image pipeline will prefer obvious, common-sense educational visuals from publicly reusable sources, preserve attribution, and keep the existing atomic lesson experience.

## Product principles

1. Relevance comes before file format.
2. Prefer the simplest visual that directly matches the slide subject.
3. A learner should understand why the image is present without interpreting abstract artwork.
4. Educational diagrams are preferred when they explain the concept better than a photograph.
5. Decorative, tangential, dense, or text-heavy images are rejected.
6. Every reused asset must have an explicit, acceptable license and a stable source page.
7. Exactly one usable image is required for every slide. The lesson remains atomic.

For example, an octagon-area lesson should progress from a clean regular octagon, to a side-and-apothem diagram, to an octagon divided into eight triangles. It should not use stop signs, decorative octagonal objects, or unrelated geometry collages when direct diagrams are available.

## Selected architecture

Use a hybrid pipeline with server-owned fallback:

- ChatGPT continues to research and write the lesson. Each slide includes a concise `imagePrompt` describing the obvious visual needed for that slide.
- ChatGPT may provide a public image candidate when it has one, including the direct image URL and source metadata.
- AskLilOwl validates every supplied candidate. Missing or unsuitable candidates trigger server-owned search against approved public educational providers.
- Wikimedia Commons is the first provider because it exposes structured search, licensing metadata, source pages, and raster previews for vector originals.
- Provider adapters make additional trusted repositories possible later without changing the lesson contract or renderer.
- ChatGPT-native file references remain accepted as an optional future-compatible path, but lesson success does not depend on them.

## Components

### 1. Public image contract

Extend each image object with optional public-source metadata:

- `source_page_url`: canonical page describing the asset.
- `creator`: creator or credited organization.
- `license_name`: normalized license label.
- `license_url`: canonical license URL when available.
- `source_organization`: repository or institution name.
- `description`: short provider-supplied description used during validation.

The existing `file_id`, `download_url`, `file_name`, and `mime_type` fields remain supported. The strict handler boundary continues to reject unknown or invalid data after diagnostic logging.

### 2. Visual request builder

Create one normalized visual request per slide from:

- lesson topic;
- slide title;
- slide body;
- `imagePrompt`;
- inferred audience.

The request should emphasize the concrete subject and teaching purpose. It must not add stylistic terms that reduce search relevance.

### 3. Provider interface

Define a small provider interface that accepts a normalized visual request and returns candidates with:

- direct asset or preview URL;
- canonical source page;
- title and description;
- MIME type and dimensions when available;
- creator and source organization;
- machine-readable license information;
- provider relevance position.

The initial Wikimedia Commons adapter will use the public MediaWiki API. It will request image metadata and thumbnails rather than scrape HTML pages.

### 4. Candidate safety and license policy

Only candidates with an explicit reusable license are eligible. The initial allowlist is:

- Public Domain;
- CC0;
- CC BY 2.0 or later;
- CC BY-SA 2.0 or later.

Reject assets that are fair-use-only, non-commercial-only, no-derivatives, missing license metadata, or hosted only on an unapproved page. This avoids making a future commercial AskLilOwl product depend on non-commercial assets.

The existing outbound network protections remain mandatory: HTTPS only, DNS and redirect validation, private-address rejection, response-size limits, timeouts, bounded concurrency, and MIME verification.

### 5. Relevance-first candidate selection

Candidate selection is deterministic and prioritizes:

1. Exact subject or concept match in title, description, and provider categories.
2. Obvious, common-sense correspondence with the slide.
3. Diagram versus photograph suitability for the teaching purpose.
4. Simplicity and absence of dense text or collage layouts.
5. Audience appropriateness.
6. Resolution and technical quality.
7. Provider result position.

License eligibility and technical safety are hard gates, not ranking bonuses. Format is considered only after relevance and eligibility.

Search should try a small sequence of increasingly broad queries derived from the visual request. It must stop once a clearly suitable candidate is found rather than collecting a large result set.

### 6. Format normalization

- PNG, JPEG, and WebP assets may be downloaded directly.
- If the best relevant public asset is an SVG, request the provider's official PNG preview at an appropriate lesson resolution.
- Never send SVG bytes to the widget.
- GIF assets are rejected by public-source discovery unless a trusted provider supplies a static PNG, JPEG, or WebP preview.
- AskLilOwl continues to proxy the selected raster bytes through `/api/images/:id` so the widget loads images from its own origin.

### 7. Attribution

Every selected public asset retains its attribution record. The lesson UI will provide a compact "Image credits" section containing:

- slide title;
- asset title when available;
- creator or organization;
- license name linked to the license;
- source page link.

Attribution is visible but does not compete with the lesson content. Public-domain and CC0 items still retain their source page for transparency.

### 8. Atomic behavior and error handling

Image preparation completes before speech generation. For every slide:

1. Validate a supplied candidate if present.
2. Search the approved provider when no valid candidate is available.
3. Normalize the winning asset to safe raster bytes.
4. Stage the image without publishing it to the cache.

Only after all slide images succeed are assets committed and the single narration request made. If any slide lacks an eligible, relevant image, AskLilOwl returns one lesson-unavailable state with a diagnostic reason. It never displays partial slides, broken images, or alt-text placeholders.

Browser-side image load failure continues to collapse the complete lesson into the same unavailable state.

## Observability

Structured logs must record, without sensitive URL values:

- provider name;
- search attempt count;
- a one-way diagnostic identifier for the normalized query;
- number of candidates evaluated;
- rejection reason counts;
- selected license family;
- selected format and whether rasterization was required;
- total download and preparation duration;
- final per-slide source kind: supplied public URL, provider search, or native file reference.

Do not log signed URLs, query tokens, full file identifiers, or user-provided sensitive text.

## Testing strategy

Use test-driven development for every production change.

### Unit tests

- Visual requests preserve the concrete subject and teaching purpose.
- Exact subject matches outrank indirect or decorative candidates.
- Diagrams outrank photographs when the slide asks for a labeled mathematical explanation.
- Format does not outrank relevance.
- Public Domain, CC0, CC BY, and CC BY-SA are accepted.
- Non-commercial, no-derivatives, fair-use, and unknown licenses are rejected.
- SVG originals resolve to provider PNG previews.
- SVG response bytes are rejected even when mislabeled.
- Attribution fields survive normalization into the lesson model.

### Provider tests

- Wikimedia API responses normalize into provider candidates.
- Pagination is bounded.
- Empty, malformed, rate-limited, and timed-out responses fail predictably.
- Redirects and preview downloads retain existing SSRF protections.

### Integration tests

- A three-slide lesson with no supplied images obtains three Wikimedia candidates, proxies all three raster assets, creates one narration request, and renders complete attribution.
- A mixed lesson can use a valid supplied public image and provider results for the remaining slides.
- One missing or ineligible image prevents audio generation and returns no structured lesson.
- A browser image-load failure produces one lesson-unavailable state.

No live OpenAI API call is needed for automated tests. Provider HTTP calls use deterministic local fixtures.

## Rollout

1. Ship the provider abstraction, license policy, relevance ranking, and Wikimedia adapter behind a server configuration flag.
2. Exercise the complete flow with offline provider fixtures.
3. Deploy with public search enabled in staging and inspect structured logs.
4. Run one visible ChatGPT lesson test. Record API credit before and after; only narration may consume the OpenAI API balance.
5. Enable the public-image pipeline in production after the lesson displays all images, narration, quiz, and attribution atomically.

## Non-goals

- No OpenAI or third-party image-generation API.
- No dependence on native ChatGPT image handoff.
- No arbitrary web-image scraping.
- No SVG bytes in the widget.
- No decorative fallback or unrelated placeholder image.
- No weakening of the existing atomic lesson requirement or network security controls.
