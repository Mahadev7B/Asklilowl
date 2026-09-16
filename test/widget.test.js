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

async function loadWidget({ openai } = {}) {
  const html = await readFile(widgetPath, "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://widget.example/lesson",
  });
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  dom.window.HTMLMediaElement.prototype.play = async function () {};
  dom.window.openai = openai;
  const script = dom.window.document.querySelector("script[type=module]").textContent;
  dom.window.eval(script);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return { dom, html };
}

test("widget reports its height after rendering a lesson", async (t) => {
  const heights = [];
  const { dom } = await loadWidget({
    openai: { notifyIntrinsicHeight: (height) => heights.push(height) },
  });
  t.after(() => dom.window.close());

  await deliver(dom, lessonResult());

  assert.ok(heights.length > 0);
});

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

test("widget lets a learner replay slides directly from the quiz", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult());
  const document = dom.window.document;

  document.querySelectorAll(".dot")[2].click();
  document.querySelector("#next").click();
  assert.equal(document.querySelector("#quiz").hidden, false);

  document.querySelector("#review-lesson").click();
  assert.equal(document.querySelector("#lesson").hidden, false);
  assert.equal(document.querySelector("#counter").textContent, "Slide 1 of 3");

  await deliver(dom, lessonResult());
  assert.equal(document.querySelector("#counter").textContent, "Slide 1 of 3");
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
    audioUrl: "https://lesson.example/api/assets/whole-lesson",
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
  assert.equal(audio.src, "https://lesson.example/api/assets/whole-lesson");
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

function imageLesson(images, openaiOverrides) {
  return {
    images,
    slides: [
      { id: "one", number: 1, title: "Wings", body: "Wings push air.", imageAlt: "A bird wing", imageIndex: 0 },
      { id: "two", number: 2, title: "Lift", body: "Lift pushes up.", imageAlt: "Air under a wing", imageIndex: 1 },
      { id: "three", number: 3, title: "Steering", body: "Tails steer.", imageAlt: "A tail turning", imageIndex: 2 },
    ],
    ...openaiOverrides,
  };
}

function slideImages(overrides) {
  return [0, 1, 2].map((index) => ({
    index,
    fileId: `file_${index}`,
    url: `https://files.oaiusercontent.com/slide-${index}.png`,
    resolvedFrom: "download_url",
    mimeType: "image/png",
    fileName: `slide-${index}.png`,
    size: null,
    ...overrides,
  }));
}

test("widget renders a supplied slide illustration", async (t) => {
  const { dom } = await loadWidget({ openai: {} });
  t.after(() => dom.window.close());

  await deliver(dom, lessonResult(imageLesson(slideImages())));

  const img = dom.window.document.querySelector("#visual img");
  assert.ok(img, "a slide image should be rendered");
  assert.equal(img.src, "https://files.oaiusercontent.com/slide-0.png");
  assert.equal(img.alt, "A bird wing");
  assert.equal(dom.window.document.querySelector(".image-diagnostic"), null);
});

test("widget names the stage and host surface when a file reference cannot be resolved", async (t) => {
  // No host file-resolution member exists, which is exactly the case eight live
  // tests could not distinguish from a CSP block.
  const { dom } = await loadWidget({ openai: { notifyIntrinsicHeight() {} } });
  t.after(() => dom.window.close());

  await deliver(
    dom,
    lessonResult(imageLesson(slideImages({ url: null, resolvedFrom: null })))
  );

  const diagnostic = dom.window.document.querySelector(".image-diagnostic");
  assert.ok(diagnostic, "an unresolved image should explain itself on screen");
  assert.match(diagnostic.textContent, /unresolved at no-host-file-api/);
  assert.match(diagnostic.textContent, /host bridge: notifyIntrinsicHeight/);
  assert.equal(dom.window.document.querySelector(".image-placeholder").textContent, "A bird wing");
});

test("widget resolves a file reference through whichever host member exists", async (t) => {
  const calls = [];
  const { dom } = await loadWidget({
    openai: {
      getFileUrl: async (request) => {
        calls.push(request);
        return { downloadUrl: "https://files.oaiusercontent.com/resolved.png" };
      },
    },
  });
  t.after(() => dom.window.close());

  await deliver(
    dom,
    lessonResult(imageLesson(slideImages({ url: null, resolvedFrom: null })))
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fileId, "file_0");
  const img = dom.window.document.querySelector("#visual img");
  assert.ok(img);
  assert.equal(img.src, "https://files.oaiusercontent.com/resolved.png");
});

test("widget reports the origin when the browser refuses a resolved image", async (t) => {
  const { dom } = await loadWidget({ openai: {} });
  t.after(() => dom.window.close());

  await deliver(dom, lessonResult(imageLesson(slideImages())));

  const img = dom.window.document.querySelector("#visual img");
  img.dispatchEvent(new dom.window.Event("error"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const diagnostic = dom.window.document.querySelector(".image-diagnostic");
  assert.ok(diagnostic, "a refused image should say where it came from");
  assert.match(diagnostic.textContent, /resolved via direct:download_url/);
  assert.match(diagnostic.textContent, /https:\/\/files\.oaiusercontent\.com/);
  assert.match(diagnostic.textContent, /browser refused to load it/);
});
