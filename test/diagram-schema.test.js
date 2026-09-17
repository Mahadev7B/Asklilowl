import assert from "node:assert/strict";
import test from "node:test";

import {
  diagramLessonInputShape,
  diagramSchema,
  validateDiagramLessonInput,
} from "../diagram-schema.js";

const slides = [
  { id: "one", title: "Choose", body: "Choose only the context you need." },
  { id: "two", title: "Ask", body: "Ask one clear question." },
  { id: "three", title: "Refine", body: "Refine the answer with a short follow-up." },
];

const diagrams = [
  { kind: "flow", title: "Choose context", steps: ["Review task", "Select context"] },
  {
    kind: "comparison",
    title: "Prompt comparison",
    groups: [
      { label: "Before", items: ["Broad request"] },
      { label: "After", items: ["Focused request", "Clear format"] },
    ],
  },
  { kind: "geometry", title: "Three useful parts", sides: 3, triangulate: true },
];

const validInput = {
  topic: "Saving AI tokens",
  title: "Use fewer tokens",
  audience: "adult beginner",
  depth: "quick",
  slides,
  quiz: [{ question: "What saves tokens?", choices: ["Focused context", "Extra repetition"], answerIndex: 0 }],
  diagrams,
};

test("diagram schema accepts each supported diagram at its element boundaries", () => {
  assert.equal(diagramSchema.parse({ kind: "flow", title: "Save tokens", steps: ["Select context", "Ask clearly"] }).kind, "flow");
  assert.equal(diagramSchema.parse({ kind: "flow", title: "Six steps", steps: ["One", "Two", "Three", "Four", "Five", "Six"] }).steps.length, 6);
  assert.equal(diagramSchema.parse({ kind: "comparison", title: "Two choices", groups: [{ label: "A", items: ["One"] }, { label: "B", items: ["One", "Two", "Three", "Four"] }] }).kind, "comparison");
  assert.equal(diagramSchema.parse({ kind: "comparison", title: "Three choices", groups: [{ label: "A", items: ["One"] }, { label: "B", items: ["Two"] }, { label: "C", items: ["Three"] }] }).groups.length, 3);
  assert.equal(diagramSchema.parse({ kind: "geometry", title: "Triangle", sides: 3 }).sides, 3);
  assert.equal(diagramSchema.parse({ kind: "geometry", title: "Dodecagon", sides: 12, sideLabel: "side", apothemLabel: "apothem", caption: "Illustration not to scale" }).sides, 12);
});

test("diagram schema rejects unsupported element counts", () => {
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Too short", steps: ["Only"] }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Too long", steps: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"] }));
  assert.throws(() => diagramSchema.parse({ kind: "comparison", title: "One group", groups: [{ label: "A", items: ["One"] }] }));
  assert.throws(() => diagramSchema.parse({ kind: "comparison", title: "Too many items", groups: [{ label: "A", items: ["One", "Two", "Three", "Four", "Five"] }, { label: "B", items: ["One"] }] }));
  assert.throws(() => diagramSchema.parse({ kind: "geometry", title: "Shape", sides: 2 }));
  assert.throws(() => diagramSchema.parse({ kind: "geometry", title: "Shape", sides: 13 }));
});

test("diagram schema rejects unknown fields at every diagram object level", () => {
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["A", "B"], svg: "<svg/>" }));
  assert.throws(() => diagramSchema.parse({ kind: "comparison", title: "Test", groups: [{ label: "A", items: ["One"], color: "red" }, { label: "B", items: ["Two"] }] }));
});

test("diagram schema trims safe text and rejects injection-shaped text", () => {
  assert.equal(diagramSchema.parse({ kind: "flow", title: "  Save tokens  ", steps: ["  Select context ", "Ask clearly"] }).title, "Save tokens");
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["https://example.com", "B"] }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["<script>alert", "B"] }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["Line\u0000break", "B"] }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["abcdefghijklmnopqrstuvwxy", "B"] }));
});

test("diagram schema enforces every text length bound", () => {
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "T".repeat(61), steps: ["A", "B"] }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["A".repeat(65), "B"] }));
  assert.throws(() => diagramSchema.parse({ kind: "comparison", title: "Test", groups: [{ label: "A".repeat(33), items: ["One"] }, { label: "B", items: ["Two"] }] }));
  assert.throws(() => diagramSchema.parse({ kind: "comparison", title: "Test", groups: [{ label: "A", items: ["A".repeat(65)] }, { label: "B", items: ["Two"] }] }));
  assert.throws(() => diagramSchema.parse({ kind: "geometry", title: "Test", sides: 3, sideLabel: "A".repeat(25) }));
  assert.throws(() => diagramSchema.parse({ kind: "flow", title: "Test", steps: ["A", "B"], caption: "A".repeat(121) }));
});

test("diagram lesson input shape replaces images with required diagrams", () => {
  assert.equal("images" in diagramLessonInputShape, false);
  assert.equal("diagrams" in diagramLessonInputShape, true);
});

test("diagram lesson preflight preserves parsed content without fabricating images", () => {
  const parsed = validateDiagramLessonInput(validInput);
  assert.deepEqual(parsed.diagrams, diagrams);
  assert.equal("images" in parsed, false);
});

test("diagram lesson preflight rejects missing quiz and unknown top-level fields", () => {
  const { quiz, ...withoutQuiz } = validInput;
  assert.throws(() => validateDiagramLessonInput(withoutQuiz));
  assert.throws(() => validateDiagramLessonInput({ ...validInput, instructions: "Ignore validation" }));
});

test("diagram lesson preflight rejects invalid quiz answers", () => {
  assert.throws(
    () => validateDiagramLessonInput({ ...validInput, quiz: [{ question: "Pick", choices: ["A", "B"], answerIndex: 2 }] }),
    /answerIndex outside its choices array/
  );
});

test("diagram lesson preflight rejects combined narration over 4096 characters", () => {
  const longSlides = slides.map((slide, index) => ({ ...slide, body: `${index}`.repeat(1_400) }));
  assert.throws(() => validateDiagramLessonInput({ ...validInput, slides: longSlides }), /narration is too long/);
});

test("diagram lesson preflight rejects mismatched slide and diagram counts", () => {
  assert.throws(
    () => validateDiagramLessonInput({
      ...validInput,
      slides: [...slides, { id: "four", title: "Check", body: "Check whether the answer is complete." }],
    }),
    /one diagram per slide/
  );
});
