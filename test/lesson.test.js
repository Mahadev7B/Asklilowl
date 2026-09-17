import assert from "node:assert/strict";
import test from "node:test";

import { buildLesson, validateLessonContent } from "../lesson.js";
import { lessonInputSchema } from "../lesson-schema.js";
import { createSpeechService } from "../speech.js";

const validLessonInput = {
  topic: "How do birds fly?",
  title: "Bird Flight",
  audience: "young learner",
  depth: "quick",
  slides: [
    { id: "one", title: "Wings", body: "Wings push air." },
    { id: "two", title: "Lift", body: "Lift pushes up." },
    { id: "three", title: "Steering", body: "Tails steer." },
  ],
  quiz: [{ question: "What helps a bird steer?", choices: ["Tail feathers", "Its beak"], answerIndex: 0 }],
};

test("lesson input accepts image references for handler diagnostics", () => {
  const result = lessonInputSchema.safeParse({
    ...validLessonInput,
    images: "file_00000000b37081fb95d0eac47eda06ce",
  });

  assert.equal(result.success, true);
});

test("lesson input accepts an array of fully described ChatGPT image files", () => {
  const result = lessonInputSchema.safeParse({
    ...validLessonInput,
    images: [
      {
        file_id: "file_00000000b37081fb95d0eac47eda06ce",
        download_url: "https://files.example/rainbow.png",
        mime_type: "image/png",
        file_name: "rainbow.png",
      },
    ],
  });

  assert.equal(result.success, true);
});

test("buildLesson preserves production lesson context and maps images to slides", () => {
  const lesson = buildLesson({
    topic: "How do birds fly?",
    title: "Birds in the Air",
    audience: "young learner",
    depth: "quick",
    summary: "Learn how wings, air, and feathers work together.",
    objectives: ["Identify the forces that help a bird fly."],
    slides: [
      {
        id: "wings",
        title: "Wings push air",
        body: "A bird pushes air down with its wings.",
        imageAlt: "A bird flapping its wings",
        imageIndex: 0,
      },
      {
        id: "lift",
        title: "Air creates lift",
        body: "Moving air helps lift the bird upward.",
      },
      {
        id: "feathers",
        title: "Feathers guide the flight",
        body: "Tail feathers help a bird steer and slow down.",
      },
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
      {
        title: "Smithsonian: Bird Flight",
        url: "https://example.org/bird-flight",
      },
    ],
    images: [
      {
        file_id: "file_bird",
        file_name: "bird.png",
        mime_type: "image/png",
      },
      {
        file_id: "file_lift",
        file_name: "lift.png",
        mime_type: "image/png",
      },
      {
        file_id: "file_feathers",
        file_name: "feathers.png",
        mime_type: "image/png",
      },
    ],
  });

  assert.equal(lesson.isDemo, false);
  assert.equal(lesson.slideCount, 3);
  assert.deepEqual(lesson.objectives, [
    "Identify the forces that help a bird fly.",
  ]);
  assert.deepEqual(lesson.sources, [
    {
      title: "Smithsonian: Bird Flight",
      url: "https://example.org/bird-flight",
    },
  ]);
  assert.equal(lesson.images[0].fileId, "file_bird");
  assert.equal(lesson.slides[0].imageIndex, 0);
  assert.equal(lesson.slides[1].imageIndex, 1);
  assert.equal(lesson.slides[2].imageIndex, 2);
});

test("buildLesson exposes public image credits without changing slide mapping", () => {
  const lesson = buildLesson({
    ...validLessonInput,
    images: validLessonInput.slides.map((slide) => ({
      download_url: `https://lesson.example/${slide.id}.png`,
      title: `${slide.title} visual`,
      source_page_url: `https://commons.wikimedia.org/wiki/File:${slide.id}.png`,
      creator: "Public educator",
      license_name: "CC0 1.0",
      license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
      source_organization: "Wikimedia Commons",
      description: `A clear visual for ${slide.title}`,
    })),
  });

  assert.equal(lesson.images[0].title, "Wings visual");
  assert.equal(lesson.images[0].creator, "Public educator");
  assert.equal(lesson.images[0].licenseName, "CC0 1.0");
  assert.equal(lesson.slides[2].imageIndex, 2);
});

test("buildLesson rejects a production lesson without one ChatGPT image per slide", () => {
  assert.throws(() => buildLesson({
    topic: "How rainbows form",
    title: "Rainbow science",
    audience: "young learner",
    depth: "standard",
    slides: [
      { id: "one", title: "Sunlight", body: "Sunlight contains many colors." },
      { id: "two", title: "Raindrops", body: "Raindrops bend the light." },
      { id: "three", title: "Colors", body: "The colors spread into a rainbow." },
    ],
    quiz: [{ question: "What bends light?", choices: ["Raindrops", "Sand"], answerIndex: 0 }],
    images: [{ file_id: "file_rainbow", file_name: "rainbow.png" }],
  }), /AskLilOwl requires one image per slide before it can show a lesson/);
});

test("buildLesson rejects a quiz answer outside the choices array", () => {
  assert.throws(
    () =>
      buildLesson({
        topic: "Photosynthesis",
        title: "How Plants Make Food",
        audience: "middle-school learner",
        depth: "standard",
        slides: [
          { id: "one", title: "Sunlight", body: "Plants capture light." },
          { id: "two", title: "Water", body: "Roots collect water." },
          { id: "three", title: "Sugar", body: "The plant makes sugar." },
        ],
        quiz: [
          {
            question: "What provides energy?",
            choices: ["Sunlight", "Moonlight"],
            answerIndex: 2,
          },
        ],
      }),
    {
      name: "RangeError",
      message:
        "A quiz question has an answerIndex outside its choices array.",
    }
  );
});

test("validateLessonContent checks quiz and narration without requiring images", () => {
  assert.doesNotThrow(() => validateLessonContent(validLessonInput));
  assert.throws(
    () => validateLessonContent({
      ...validLessonInput,
      quiz: [{ question: "Pick one", choices: ["A", "B"], answerIndex: 2 }],
    }),
    /answerIndex outside its choices array/
  );
  assert.throws(
    () => validateLessonContent({
      ...validLessonInput,
      slides: validLessonInput.slides.map((slide, index) => ({ ...slide, body: `${index}`.repeat(1_400) })),
    }),
    /narration is too long/
  );
});

test("buildLesson narrates the visible slide description verbatim", () => {
  const speechService = createSpeechService({ apiKey: "test", tokenSecret: "d".repeat(32), publicOrigin: "https://lesson.example" });
  const lesson = buildLesson({
    topic: "Photosynthesis", title: "How Plants Make Food", audience: "middle school", depth: "standard",
    slides: [
      { id: "one", title: "Light", body: "Leaves capture sunlight." },
      { id: "two", title: "Ingredients", body: "Plants use water and carbon dioxide.", narration: "This legacy narration must not replace the visible description." },
      { id: "three", title: "Sugar", body: "The plant stores energy in sugar." },
    ],
    images: [
      { file_id: "file_light", download_url: "https://files.example/light.png" },
      { file_id: "file_ingredients", download_url: "https://files.example/ingredients.png" },
      { file_id: "file_sugar", download_url: "https://files.example/sugar.png" },
    ],
    quiz: [{ question: "What captures light?", choices: ["Leaves", "Roots"], answerIndex: 0 }],
  }, { speechService });
  assert.equal(lesson.slides[0].narration, "Leaves capture sunlight.");
  assert.equal(lesson.slides[1].narration, "Plants use water and carbon dioxide.");
  assert.equal(lesson.audioUrl, null);
  assert.equal(lesson.slides[0].audioCueSeconds, 0);
  assert.ok(lesson.slides[1].audioCueSeconds > lesson.slides[0].audioCueSeconds);
  assert.equal("audioUrl" in lesson.slides[0], false);
  assert.deepEqual(lesson.voice, { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." });
});
