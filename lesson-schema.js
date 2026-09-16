import { z } from "zod";

export const INPUT_LIMITS = Object.freeze({
  topic: 240,
  title: 120,
  audience: 80,
  summary: 600,
  objectives: 8,
  objective: 240,
  slides: 20,
  slideId: 64,
  slideTitle: 140,
  slideBody: 4_000,
  funFact: 600,
  imageAlt: 300,
  imagePrompt: 1_000,
  narration: 2_000,
  lessonNarration: 4_096,
  quiz: 10,
  quizQuestion: 500,
  quizChoice: 240,
  quizExplanation: 1_000,
  sources: 12,
  sourceTitle: 200,
  sourceUrl: 2_048,
  images: 20,
  imageReference: 4_096,
  imageFileName: 255,
  imageMimeType: 100,
  imageBytes: 25 * 1024 * 1024,
});

const boundedText = (label, maximum) =>
  z.string().trim().min(1, `${label} is required.`).max(maximum);

const httpUrlSchema = z
  .string()
  .trim()
  .max(INPUT_LIMITS.sourceUrl)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "URL must use HTTP or HTTPS.");

export const slideSchema = z.object({
  id: boundedText("Slide id", INPUT_LIMITS.slideId),
  title: boundedText("Slide title", INPUT_LIMITS.slideTitle),
  body: boundedText("Slide body", INPUT_LIMITS.slideBody),
  funFact: z.string().trim().max(INPUT_LIMITS.funFact).optional(),
  imageAlt: z.string().trim().max(INPUT_LIMITS.imageAlt).optional(),
  imagePrompt: boundedText("Slide image prompt", INPUT_LIMITS.imagePrompt).optional(),
  imageIndex: z.number().int().nonnegative().max(INPUT_LIMITS.images - 1).optional(),
  narration: z.string().trim().min(1).max(INPUT_LIMITS.narration).optional(),
});

export const quizQuestionSchema = z.object({
  question: boundedText("Quiz question", INPUT_LIMITS.quizQuestion),
  choices: z
    .array(boundedText("Quiz choice", INPUT_LIMITS.quizChoice))
    .min(2)
    .max(6),
  answerIndex: z.number().int().nonnegative(),
  explanation: z.string().trim().max(INPUT_LIMITS.quizExplanation).optional(),
});

export const sourceSchema = z.object({
  title: boundedText("Source title", INPUT_LIMITS.sourceTitle),
  url: httpUrlSchema,
});

const imageObjectSchema = z
  .object({
    file_id: z.string().trim().min(1).max(256),
    download_url: httpUrlSchema,
    file_name: z.string().trim().min(1).max(INPUT_LIMITS.imageFileName).optional(),
    mime_type: z.string().trim().min(1).max(INPUT_LIMITS.imageMimeType).optional(),
  })
  .strict();

const receivedImagesSchema = z.preprocess(
  (value) => value == null || Array.isArray(value) ? value : [value],
  z.array(z.union([z.string(), z.object({}).passthrough()])).max(INPUT_LIMITS.images)
);

export const lessonInputShape = {
  topic: boundedText("Topic", INPUT_LIMITS.topic).describe(
    "The topic or question being explained."
  ),
  title: boundedText("Title", INPUT_LIMITS.title).describe("Short lesson title."),
  audience: boundedText("Audience", INPUT_LIMITS.audience).describe(
    "Intended learner level, such as young learner, teen, adult, or expert."
  ),
  depth: z
    .enum(["quick", "standard", "deep"])
    .default("standard")
    .describe("Requested lesson depth."),
  summary: z
    .string()
    .trim()
    .max(INPUT_LIMITS.summary)
    .optional()
    .describe("One-sentence overview of what the learner will understand."),
  objectives: z
    .array(boundedText("Learning objective", INPUT_LIMITS.objective))
    .max(INPUT_LIMITS.objectives)
    .default([])
    .describe("Specific learning objectives covered by the lesson."),
  slides: z
    .array(slideSchema)
    .min(3)
    .max(INPUT_LIMITS.slides)
    .describe("Dynamically sized lesson slides, written for the requested learner level."),
  quiz: z
    .array(quizQuestionSchema)
    .min(1)
    .max(INPUT_LIMITS.quiz)
    .describe("Short multiple-choice comprehension quiz matched to the lesson."),
  sources: z
    .array(sourceSchema)
    .max(INPUT_LIMITS.sources)
    .default([])
    .describe("HTTP(S) source links used for researched or time-sensitive claims."),
  images: receivedImagesSchema
    .optional()
    .describe("ChatGPT-managed educational image files. Pass an array of file objects with file_id and download_url."),
};

export const lessonInputSchema = z.object(lessonInputShape).superRefine((lesson, context) => {
  lesson.quiz.forEach((item, index) => {
    if (item.answerIndex >= item.choices.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quiz", index, "answerIndex"],
        message: "answerIndex must identify one of this question's choices.",
      });
    }
  });
});

const strictLessonInputSchema = z.object({
  ...lessonInputShape,
  images: z.array(imageObjectSchema).max(INPUT_LIMITS.images).optional(),
});

export function validateStrictLessonInput(input) {
  return strictLessonInputSchema.parse(input);
}

const normalizedImageSchema = z.object({
  index: z.number().int().nonnegative(),
  fileId: z.string().max(256).nullable(),
  url: httpUrlSchema.nullable(),
  mimeType: z.string().max(INPUT_LIMITS.imageMimeType).nullable(),
  fileName: z.string().min(1).max(INPUT_LIMITS.imageFileName),
  size: z.number().int().nonnegative().max(INPUT_LIMITS.imageBytes).nullable(),
});

const renderedSlideSchema = slideSchema.extend({
  number: z.number().int().positive(),
  imageIndex: z.number().int().nonnegative().nullable(),
  narration: z.string().min(1).max(INPUT_LIMITS.narration),
  audioCueSeconds: z.number().nonnegative(),
});

const voiceSchema = z.object({
  available: z.boolean(),
  provider: z.literal("openai").nullable(),
  model: z.string().nullable(),
  voice: z.string().nullable(),
  disclosure: z.string(),
});

export const lessonOutputSchema = z.object({
  topic: boundedText("Topic", INPUT_LIMITS.topic),
  title: boundedText("Title", INPUT_LIMITS.title),
  audience: boundedText("Audience", INPUT_LIMITS.audience),
  depth: z.enum(["quick", "standard", "deep"]),
  summary: z.string().max(INPUT_LIMITS.summary),
  objectives: z.array(z.string().min(1).max(INPUT_LIMITS.objective)).max(INPUT_LIMITS.objectives),
  slideCount: z.number().int().min(3).max(INPUT_LIMITS.slides),
  slides: z.array(renderedSlideSchema).min(3).max(INPUT_LIMITS.slides),
  audioUrl: httpUrlSchema.nullable(),
  narrationDurationEstimateSeconds: z.number().nonnegative(),
  quiz: z.array(quizQuestionSchema).min(1).max(INPUT_LIMITS.quiz),
  sources: z.array(sourceSchema).max(INPUT_LIMITS.sources),
  images: z.array(normalizedImageSchema).max(INPUT_LIMITS.images),
  isDemo: z.boolean(),
  voice: voiceSchema,
});

export const lessonOutputShape = {
  lesson: lessonOutputSchema,
};
