import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_LESSON_IDS,
  getDemoLesson,
  isDemoModeEnabled,
} from "../demo-fixtures.js";

test("Inspector demo mode offers four clearly marked lesson fixtures", () => {
  assert.deepEqual(DEMO_LESSON_IDS, [
    "birds-young-learner",
    "photosynthesis-middle-school",
    "database-indexes-adult",
    "current-topic-workflow",
  ]);

  for (const fixtureId of DEMO_LESSON_IDS) {
    const lesson = getDemoLesson(fixtureId, {
      publicOrigin: "http://localhost:8787",
    });

    assert.equal(lesson.isDemo, true);
    assert.ok(lesson.slides.length >= 3);
    assert.ok(lesson.quiz.length >= 1);
  }

  const birdLesson = getDemoLesson("birds-young-learner", {
    publicOrigin: "http://localhost:8787",
  });
  assert.equal(
    birdLesson.images[0].url,
    "http://localhost:8787/test-bird.svg"
  );
});

test("an unknown Inspector fixture is rejected", () => {
  assert.throws(() => getDemoLesson("missing-fixture"), {
    name: "RangeError",
    message: "Unknown AskLilOwl demo lesson: missing-fixture",
  });
});

test("Inspector demo tools require an explicit true flag", () => {
  assert.equal(isDemoModeEnabled({ ASKLILOWL_DEMO_MODE: "true" }), true);
  assert.equal(isDemoModeEnabled({ ASKLILOWL_DEMO_MODE: "false" }), false);
  assert.equal(isDemoModeEnabled({}), false);
});
