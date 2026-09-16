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

test("image inputs accept whatever shape ChatGPT hands over", () => {
  // Input validation runs before the tool handler, so a strict schema turns an
  // unexpected handoff into a rejection we never see. Accept the shape here and
  // let buildLesson decide whether it is usable, so failures stay diagnosable.
  const fileIdOnly = validInput();
  fileIdOnly.images = [{ file_id: "file_abc123" }];
  assert.equal(lessonInputSchema.safeParse(fileIdOnly).success, true);

  const unknownFields = validInput();
  unknownFields.images = [{ id: "file_abc123", width: 1024, container: { kind: "image" } }];
  assert.equal(lessonInputSchema.safeParse(unknownFields).success, true);

  const inline = validInput();
  inline.images = ["data:image/png;base64,AAAA"];
  assert.equal(lessonInputSchema.safeParse(inline).success, true);

  // images is a list; a bare string is still not one.
  const bareString = validInput();
  bareString.images = "file_abc123";
  assert.equal(lessonInputSchema.safeParse(bareString).success, false);

  const oversized = validInput();
  oversized.images = [`data:image/png;base64,${"A".repeat(INPUT_LIMITS.imagePayload)}`];
  assert.equal(lessonInputSchema.safeParse(oversized).success, false);
});

test("an unrenderable image reference never reaches the widget as a URL", () => {
  const lesson = buildLesson({
    ...validInput(),
    images: [
      { file_id: "file_one", download_url: "javascript:alert(1)" },
      { file_id: "file_two", download_url: "https://files.example/two.png" },
      { file_id: "file_three" },
    ],
  });

  // A javascript: reference is not a renderable URL, so it is dropped rather
  // than handed to the widget; the file id survives for the host to resolve.
  assert.equal(lesson.images[0].url, null);
  assert.equal(lesson.images[0].fileId, "file_one");
  assert.equal(lesson.images[1].url, "https://files.example/two.png");
  assert.equal(lesson.images[1].resolvedFrom, "download_url");
  assert.equal(lesson.images[2].url, null);
});

test("buildLesson explains an image handoff it cannot read", () => {
  assert.throws(
    () => buildLesson({ ...validInput(), images: [{ width: 1 }, { width: 2 }, { width: 3 }] }),
    /could not read a file reference or URL from 3 of 3 images/i
  );
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
