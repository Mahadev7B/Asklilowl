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
    };
  });
}

export function buildLesson(args, { isDemo = false } = {}) {
  const invalidQuiz = args.quiz.find(
    (item) => item.answerIndex < 0 || item.answerIndex >= item.choices.length
  );

  if (invalidQuiz) {
    throw new RangeError(
      "A quiz question has an answerIndex outside its choices array."
    );
  }

  const images = normalizeImages(args.images);
  const slides = args.slides.map((slide, index) => ({
    ...slide,
    number: index + 1,
    imageIndex:
      typeof slide.imageIndex === "number" && slide.imageIndex < images.length
        ? slide.imageIndex
        : images[index]
          ? index
          : null,
  }));

  return lessonOutputSchema.parse({
    topic: args.topic,
    title: args.title,
    audience: args.audience,
    depth: args.depth,
    summary: args.summary ?? "",
    objectives: args.objectives ?? [],
    slideCount: slides.length,
    slides,
    quiz: args.quiz,
    sources: args.sources ?? [],
    images,
    isDemo,
  });
}
