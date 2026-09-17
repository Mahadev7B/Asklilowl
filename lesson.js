import { lessonOutputSchema } from "./lesson-schema.js";

export function normalizeImages(input) {
  const images = Array.isArray(input) ? input : input ? [input] : [];

  return images.map((image, index) => {
    if (typeof image === "string") {
      return {
        index,
        fileId:
          image.startsWith("file_") || image.startsWith("file-")
            ? image
            : null,
        url:
          /^https?:\/\//i.test(image) || image.startsWith("data:")
            ? image
            : null,
        mimeType: null,
        fileName: `lesson-image-${index + 1}`,
        size: null,
        title: null,
        sourcePageUrl: null,
        creator: null,
        licenseName: null,
        licenseUrl: null,
        sourceOrganization: null,
        description: null,
      };
    }

    return {
      index,
      fileId: image?.file_id ?? image?.fileId ?? null,
      url: image?.download_url ?? image?.downloadUrl ?? image?.url ?? null,
      mimeType: image?.mime_type ?? image?.mimeType ?? null,
      fileName:
        image?.file_name ??
        image?.fileName ??
        image?.name ??
        `lesson-image-${index + 1}`,
      size: image?.size ?? null,
      title: image?.title ?? null,
      sourcePageUrl: image?.source_page_url ?? image?.sourcePageUrl ?? null,
      creator: image?.creator ?? null,
      licenseName: image?.license_name ?? image?.licenseName ?? null,
      licenseUrl: image?.license_url ?? image?.licenseUrl ?? null,
      sourceOrganization: image?.source_organization ?? image?.sourceOrganization ?? null,
      description: image?.description ?? null,
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
  if (!isDemo && images.length !== args.slides.length) {
    throw new RangeError("AskLilOwl requires one image per slide before it can show a lesson.");
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
