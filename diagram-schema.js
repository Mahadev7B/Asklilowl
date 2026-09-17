import { z } from "zod";

import { lessonInputShape } from "./lesson-schema.js";
import { validateLessonContent } from "./lesson.js";

const unsafeControls = /[\u0000-\u001f\u007f-\u009f]/;
const markupDelimiters = /[<>]/;
const urlScheme = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:data|file|javascript):)/i;
const oversizedToken = /\S{25,}/;

function diagramText(label, maximum) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maximum)
    .refine((value) => !unsafeControls.test(value), `${label} cannot contain control characters.`)
    .refine((value) => !markupDelimiters.test(value), `${label} cannot contain markup delimiters.`)
    .refine((value) => !urlScheme.test(value), `${label} cannot contain a URL scheme.`)
    .refine((value) => !oversizedToken.test(value), `${label} cannot contain an unbroken token longer than 24 characters.`);
}

const titleSchema = diagramText("Diagram title", 60);
const captionSchema = diagramText("Diagram caption", 120);

const flowDiagramSchema = z
  .object({
    kind: z.literal("flow"),
    title: titleSchema,
    steps: z.array(diagramText("Flow step", 64)).min(2).max(6),
    caption: captionSchema.optional(),
  })
  .strict();

const comparisonGroupSchema = z
  .object({
    label: diagramText("Comparison group label", 32),
    items: z.array(diagramText("Comparison item", 64)).min(1).max(4),
  })
  .strict();

const comparisonDiagramSchema = z
  .object({
    kind: z.literal("comparison"),
    title: titleSchema,
    groups: z.array(comparisonGroupSchema).min(2).max(3),
    caption: captionSchema.optional(),
  })
  .strict();

const geometryDiagramSchema = z
  .object({
    kind: z.literal("geometry"),
    title: titleSchema,
    sides: z.number().int().min(3).max(12),
    triangulate: z.boolean().optional(),
    sideLabel: diagramText("Geometry side label", 24).optional(),
    apothemLabel: diagramText("Geometry apothem label", 24).optional(),
    caption: captionSchema.optional(),
  })
  .strict();

export const diagramSchema = z.discriminatedUnion("kind", [
  flowDiagramSchema,
  comparisonDiagramSchema,
  geometryDiagramSchema,
]);

const { images, ...contentShape } = lessonInputShape;

export const diagramLessonInputShape = {
  ...contentShape,
  diagrams: z.array(diagramSchema).min(3).max(20),
};

const diagramLessonInputSchema = z.object(diagramLessonInputShape).strict();

export function validateDiagramLessonInput(input) {
  const args = diagramLessonInputSchema.parse(input);
  if (args.diagrams.length !== args.slides.length) {
    throw new RangeError("AskLilOwl requires one diagram per slide.");
  }
  validateLessonContent(args);
  return args;
}
