import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { JSDOM } from "jsdom";

const widgetPath = new URL("../public/lesson-widget.html", import.meta.url);

function lessonResult(overrides = {}) {
  const lesson = {
    topic: "How do birds fly?",
    title: "Bird Flight",
    audience: "young learner",
    depth: "quick",
    summary: "Learn how birds move through the air.",
    objectives: ["Explain lift."],
    slideCount: 3,
    slides: [
      { id: "one", number: 1, title: "Wings", body: "Wings push air.", imageIndex: null },
      { id: "two", number: 2, title: "Lift", body: "Lift pushes up.", imageIndex: null },
      { id: "three", number: 3, title: "Steering", body: "Tails steer.", imageIndex: null },
    ],
    quiz: [
      {
        question: "What helps a bird steer?",
        choices: ["Tail feathers", "Its beak"],
        answerIndex: 0,
        explanation: "Tail feathers act like a rudder.",
      },
    ],
    sources: [{ title: "Bird source", url: "https://example.org/birds" }],
    images: [],
    isDemo: false,
    voice: { available: false, provider: null, model: null, voice: null, disclosure: "" },
    ...overrides,
  };
  return { structuredContent: { lesson } };
}

async function loadWidget() {
  const html = await readFile(widgetPath, "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://widget.example/lesson",
  });
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  dom.window.HTMLMediaElement.prototype.play = async function () {};
  const script = dom.window.document.querySelector("script[type=module]").textContent;
  dom.window.eval(script);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return { dom, html };
}

async function deliver(dom, response) {
  dom.window.dispatchEvent(
    new dom.window.MessageEvent("message", {
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: response,
      },
      source: dom.window,
    })
  );
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

test("widget renders a lesson and exposes semantic progress navigation", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult());
  const document = dom.window.document;

  assert.equal(document.querySelector("#lesson").hidden, false);
  assert.equal(document.querySelector("#lesson-title").textContent, "Bird Flight");
  assert.equal(document.querySelector("#counter").textContent, "Slide 1 of 3");
  assert.equal(document.querySelector("#progress-shell").getAttribute("role"), "progressbar");
  assert.equal(document.querySelector("#progress-shell").getAttribute("aria-valuenow"), "1");
  assert.equal(document.querySelectorAll(".dot").length, 3);
  assert.equal(document.querySelector(".dot").getAttribute("aria-current"), "step");

  document.querySelector("#next").click();
  assert.equal(document.querySelector("#counter").textContent, "Slide 2 of 3");
  assert.equal(document.querySelector("#progress-shell").getAttribute("aria-valuenow"), "2");
});

test("widget restores non-sensitive progress for the same lesson", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult());
  dom.window.document.querySelector("#next").click();

  await deliver(dom, lessonResult());
  assert.equal(dom.window.document.querySelector("#counter").textContent, "Slide 2 of 3");

  await deliver(dom, lessonResult({ title: "A Different Lesson" }));
  assert.equal(dom.window.document.querySelector("#counter").textContent, "Slide 1 of 3");
});

test("widget quiz announces feedback and supports lesson review", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult());
  const document = dom.window.document;

  document.querySelectorAll(".dot")[2].click();
  document.querySelector("#next").click();
  assert.equal(document.querySelector("#quiz").hidden, false);
  assert.equal(document.querySelector("#feedback").getAttribute("aria-live"), "polite");

  document.querySelectorAll(".choice")[0].click();
  assert.match(document.querySelector("#feedback").textContent, /Correct/);
  document.querySelector("#quiz-next").click();
  assert.equal(document.querySelector("#score").hidden, false);
  assert.match(document.querySelector("#score").textContent, /1 \/ 1/);
});

test("widget reports tool failures and incomplete results", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, {
    isError: true,
    content: [{ type: "text", text: "Please regenerate the lesson." }],
  });

  assert.equal(dom.window.document.querySelector("#empty").hidden, false);
  assert.match(dom.window.document.querySelector("#empty-message").textContent, /regenerate/);
});

test("widget follows host styling and identity guidance", async (t) => {
  const { dom, html } = await loadWidget();
  t.after(() => dom.window.close());

  assert.doesNotMatch(html, /class="(?:owl|brand|quiz-brand)"/);
  assert.doesNotMatch(html, /(?:linear|radial)-gradient/);
  assert.match(html, /font-family:\s*system-ui/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media \(max-width: 560px\)/);
});

test("widget plays one lesson track and changes slides at its cue times", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  let playCalls = 0;
  dom.window.HTMLMediaElement.prototype.play = async function () { playCalls += 1; };
  await deliver(dom, lessonResult({
    voice: { available: true, provider: "openai", model: "gpt-4o-mini-tts", voice: "nova", disclosure: "AI-generated voice." },
    audioUrl: "https://lesson.example/api/speech/whole-lesson",
    slides: [
      { id: "one", number: 1, title: "Light", body: "Leaves capture light.", narration: "Leaves capture light.", audioCueSeconds: 0, imageIndex: null },
      { id: "two", number: 2, title: "Water", body: "Roots absorb water.", narration: "Roots absorb water.", audioCueSeconds: 4, imageIndex: null },
      { id: "three", number: 3, title: "Sugar", body: "Plants make sugar.", narration: "Plants make sugar.", audioCueSeconds: 8, imageIndex: null },
    ],
  }));
  const document = dom.window.document;
  assert.equal(document.querySelector("#voice-start").hidden, false);
  assert.equal(document.querySelector("#narration-transcript").textContent, "Leaves capture light.");
  document.querySelector("#voice-start").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(playCalls, 1);
  const audio = document.querySelector("#lesson-audio");
  assert.equal(audio.src, "https://lesson.example/api/speech/whole-lesson");
  Object.defineProperty(audio, "currentTime", { configurable: true, value: 4 });
  audio.dispatchEvent(new dom.window.Event("timeupdate"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(document.querySelector("#counter").textContent, "Slide 2 of 3");
  audio.dispatchEvent(new dom.window.Event("ended"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(document.querySelector("#quiz").hidden, false);
  assert.equal(playCalls, 1);
  assert.match(document.querySelector("#voice-disclosure").textContent, /AI-generated voice/);
});
