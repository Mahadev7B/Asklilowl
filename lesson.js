import { lessonOutputSchema } from "./lesson-schema.js";

const DATA_URI = /^data:image\//i;
const HTTP_URI = /^https?:\/\//i;
const FILE_ID = /^file[-_]/i;

// ChatGPT hands images over in whichever shape the host uses, so probe the
// plausible carriers in order and record which one produced the result. The
// resolvedFrom label is what tells us, from a log or the widget, how a handoff
// actually arrived rather than how we assumed it would.
function readImageUrl(image) {
  const direct = [
    ["download_url", image?.download_url],
    ["downloadUrl", image?.downloadUrl],
    ["url", image?.url],
    ["image_url", typeof image?.image_url === "string" ? image.image_url : image?.image_url?.url],
    ["source_url", image?.source_url],
  ];

  for (const [key, value] of direct) {
    if (typeof value === "string" && (HTTP_URI.test(value) || DATA_URI.test(value))) {
      return { url: value, resolvedFrom: key };
    }
  }

  const inline = [
    ["b64_json", image?.b64_json],
    ["data", typeof image?.data === "string" ? image.data : null],
    ["content", typeof image?.content === "string" ? image.content : null],
  ];

  for (const [key, value] of inline) {
    if (typeof value === "string" && value.length) {
      const mime = image?.mime_type ?? image?.mimeType ?? "image/png";
      return { url: `data:${mime};base64,${value}`, resolvedFrom: key };
    }
  }

  return { url: null, resolvedFrom: null };
}

function readFileId(image) {
  for (const candidate of [image?.file_id, image?.fileId, image?.id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function normalizeImages(input) {
  const images = Array.isArray(input) ? input : input ? [input] : [];

  return images.map((image, index) => {
    if (typeof image === "string") {
      const isUrl = HTTP_URI.test(image) || DATA_URI.test(image);
      return {
        index,
        fileId: FILE_ID.test(image) ? image : null,
        url: isUrl ? image : null,
        resolvedFrom: isUrl ? "string" : null,
        mimeType: null,
        fileName: `lesson-image-${index + 1}`,
        size: null,
      };
    }

    const { url, resolvedFrom } = readImageUrl(image);

    return {
      index,
      fileId: readFileId(image),
      url,
      resolvedFrom,
      mimeType: image?.mime_type ?? image?.mimeType ?? null,
      fileName:
        image?.file_name ??
        image?.fileName ??
        image?.name ??
        `lesson-image-${index + 1}`,
      size: typeof image?.size === "number" ? image.size : null,
    };
  });
}

const disabledVoice = { available: false, provider: null, model: null, voice: null, disclosure: "" };

function estimateNarrationSeconds(narration) {
  const wordCount = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.ceil(wordCount / 2.5) + 1);
}

export function buildLesson(args, { isDemo = false, speechService = null, images: preparedImages, audioUrl: preparedAudioUrl, voice: preparedVoice } = {}) {
  const invalidQuiz = args.quiz.find(
    (item) => item.answerIndex < 0 || item.answerIndex >= item.choices.length
  );

  if (invalidQuiz) {
    throw new RangeError(
      "A quiz question has an answerIndex outside its choices array."
    );
  }

  const images = normalizeImages(preparedImages ?? args.images);
  if (!isDemo) {
    // Say which half of the contract failed. "Lesson not available" taught us
    // nothing across eight live tests; ChatGPT can act on these.
    if (images.length !== args.slides.length) {
      throw new RangeError(
        `AskLilOwl needs one image per slide: ${args.slides.length} slides but ${images.length} image${images.length === 1 ? "" : "s"} were passed.`
      );
    }
    const unusable = images.filter((image) => !image.url && !image.fileId);
    if (unusable.length) {
      throw new RangeError(
        `AskLilOwl could not read a file reference or URL from ${unusable.length} of ${images.length} images. Pass each generated image as a file object that carries a file id or a download URL.`
      );
    }
  }
  let cueSeconds = 0;
  const slides = args.slides.map((slide, index) => {
    const narration = slide.body;
    const renderedSlide = {
      ...slide,
      narration,
      audioCueSeconds: cueSeconds,
      number: index + 1,
      imageIndex: preparedImages
        ? index
        : typeof slide.imageIndex === "number" && slide.imageIndex < images.length
          ? slide.imageIndex
          : images.length
            ? index % images.length
            : null,
    };
    cueSeconds += estimateNarrationSeconds(narration);
    return renderedSlide;
  });
  const lessonNarration = slides.map((slide) => slide.narration).join("\n\n");
  if (lessonNarration.length > 4_096) {
    throw new RangeError("Lesson narration is too long for one voice track. Please use fewer slides or make each narration more concise.");
  }

  return lessonOutputSchema.parse({
    topic: args.topic,
    title: args.title,
    audience: args.audience,
    depth: args.depth,
    summary: args.summary ?? "",
    objectives: args.objectives ?? [],
    slideCount: slides.length,
    slides,
    audioUrl: preparedAudioUrl ?? null,
    narrationDurationEstimateSeconds: cueSeconds,
    quiz: args.quiz,
    sources: args.sources ?? [],
    images,
    isDemo,
    voice: preparedVoice ?? speechService?.metadata?.() ?? disabledVoice,
  });
}
