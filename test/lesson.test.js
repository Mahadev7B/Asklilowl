import assert from "node:assert/strict";
import test from "node:test";

import { buildLesson } from "../lesson.js";
import { createSpeechService } from "../speech.js";

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
  assert.equal(lesson.slides[1].imageIndex, null);
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

test("buildLesson narrates the visible slide description verbatim", () => {
  const speechService = createSpeechService({ apiKey: "test", tokenSecret: "d".repeat(32), publicOrigin: "https://lesson.example" });
  const lesson = buildLesson({
    topic: "Photosynthesis", title: "How Plants Make Food", audience: "middle school", depth: "standard",
    slides: [
      { id: "one", title: "Light", body: "Leaves capture sunlight." },
      { id: "two", title: "Ingredients", body: "Plants use water and carbon dioxide.", narration: "This legacy narration must not replace the visible description." },
      { id: "three", title: "Sugar", body: "The plant stores energy in sugar." },
    ],
    quiz: [{ question: "What captures light?", choices: ["Leaves", "Roots"], answerIndex: 0 }],
  }, { speechService });
  assert.equal(lesson.slides[0].narration, "Leaves capture sunlight.");
  assert.equal(lesson.slides[1].narration, "Plants use water and carbon dioxide.");
  assert.match(lesson.audioUrl, /^https:\/\/lesson\.example\/api\/speech\//);
  assert.equal(lesson.slides[0].audioCueSeconds, 0);
  assert.ok(lesson.slides[1].audioCueSeconds > lesson.slides[0].audioCueSeconds);
  assert.equal("audioUrl" in lesson.slides[0], false);
  assert.deepEqual(lesson.voice, { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." });
});
