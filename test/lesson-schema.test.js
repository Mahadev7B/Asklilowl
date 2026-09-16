import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_LIMITS,
  lessonInputSchema,
  lessonOutputSchema,
} from "../lesson-schema.js";
import { buildLesson } from "../lesson.js";

function validInput() {
  return {
    topic: "How do birds fly?",
    title: "Birds in the Air",
    audience: "young learner",
    depth: "quick",
    summary: "Learn how wings, air, and feathers work together.",
    objectives: ["Identify the forces that help a bird fly."],
    slides: [
      { id: "wings", title: "Wings", body: "Wings push air down.", imagePrompt: "A bird moving air with its wings." },
      { id: "lift", title: "Lift", body: "Air helps lift the bird.", imagePrompt: "Air flowing over a bird wing." },
      { id: "steer", title: "Steering", body: "Tail feathers steer.", imagePrompt: "A bird steering with its tail feathers." },
    ],
    quiz: [
      {
        question: "What helps a bird steer?",
        choices: ["Tail feathers", "Its beak"],
        answerIndex: 0,
        explanation: "Tail feathers work like a rudder.",
      },
    ],
    sources: [
      { title: "Bird flight reference", url: "https://example.org/birds" },
    ],
    images: ["wings", "lift", "steer"].map((name) => ({
      file_id: `file_${name}`,
      download_url: `https://files.example/${name}.png`,
      file_name: `${name}.png`,
      mime_type: "image/png",
    })),
  };
}

test("lesson input accepts a bounded production lesson", () => {
  const parsed = lessonInputSchema.parse(validInput());
  assert.equal(parsed.slides.length, 3);
  assert.equal(parsed.depth, "quick");
});

test("lesson input accepts internal visual prompts for every slide", () => {
  const input = validInput();
  input.slides.forEach((slide) => { slide.imagePrompt = `Simple visual for ${slide.title}.`; });

  const result = lessonInputSchema.safeParse(input);
  assert.equal(result.success, true);
});

test("buildLesson rejects a lesson without one prepared image per slide", () => {
  const input = validInput();
  input.slides.forEach((slide) => { slide.imagePrompt = `Simple visual for ${slide.title}.`; });

  assert.throws(
    () => buildLesson(input, { images: [] }),
    /one image per slide/i
  );
});

test("lesson input rejects oversized fields and arrays", () => {
  const oversizedTopic = validInput();
  oversizedTopic.topic = "x".repeat(INPUT_LIMITS.topic + 1);
  assert.equal(lessonInputSchema.safeParse(oversizedTopic).success, false);

  const tooManyObjectives = validInput();
  tooManyObjectives.objectives = Array.from(
    { length: INPUT_LIMITS.objectives + 1 },
    (_, index) => `Objective ${index}`
  );
  assert.equal(lessonInputSchema.safeParse(tooManyObjectives).success, false);

  const tooManyImages = validInput();
  tooManyImages.images = Array.from(
    { length: INPUT_LIMITS.images + 1 },
    (_, index) => ({
      file_id: `file_${index}`,
      download_url: `https://files.example/${index}.png`,
    })
  );
  assert.equal(lessonInputSchema.safeParse(tooManyImages).success, false);
});

test("source links must use HTTP or HTTPS", () => {
  const input = validInput();
  input.sources = [{ title: "Local file", url: "file:///private/lesson.txt" }];
  assert.equal(lessonInputSchema.safeParse(input).success, false);

  input.sources = [{ title: "FTP source", url: "ftp://example.org/lesson" }];
  assert.equal(lessonInputSchema.safeParse(input).success, false);
});

test("image inputs must be fully described ChatGPT file objects", () => {
  const unsafe = validInput();
  unsafe.images = "javascript:alert(1)";
  assert.equal(lessonInputSchema.safeParse(unsafe).success, false);

  const inline = validInput();
  inline.images = "data:image/png;base64,AAAA";
  assert.equal(lessonInputSchema.safeParse(inline).success, false);

  const file = validInput();
  file.images = "file_abc123";
  assert.equal(lessonInputSchema.safeParse(file).success, false);

  const missingDownloadUrl = validInput();
  missingDownloadUrl.images = [{ file_id: "file_abc123" }];
  assert.equal(lessonInputSchema.safeParse(missingDownloadUrl).success, false);
});

test("quiz answer indices are validated against each choices array", () => {
  const input = validInput();
  input.quiz[0].answerIndex = 2;
  const result = lessonInputSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /answerIndex/i);
});

test("normalized lesson output conforms to the declared output schema", () => {
  const input = lessonInputSchema.parse(validInput());
  const lesson = buildLesson(input);
  const parsed = lessonOutputSchema.parse(lesson);

  assert.equal(parsed.slideCount, 3);
  assert.equal(parsed.images[0].fileId, "file_wings");
});
