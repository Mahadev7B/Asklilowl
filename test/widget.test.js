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
  const slides = lesson.slides.map((slide, index) => ({
    ...slide,
    imageIndex: slide.imageIndex ?? index,
  }));
  const images = Object.hasOwn(overrides, "images")
    ? lesson.images
    : slides.map((_, index) => ({
      index,
      fileId: `file_${index + 1}`,
      url: `https://files.example/${index + 1}.png`,
    }));
  return { structuredContent: { lesson: { ...lesson, slides, images } } };
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

  await deliver(dom, lessonResult({
    slides: [
      { id: "one", number: 1, title: "Wings", body: "Wings push air.", imageIndex: 0 },
      { id: "two", number: 2, title: "Lift", body: "Lift pushes up.", imageIndex: 1 },
      { id: "three", number: 3, title: "Steering", body: "Tails steer.", imageIndex: 2 },
    ],
    images: [
      { index: 0, fileId: "file_one", url: "https://files.example/one.png" },
      { index: 1, fileId: "file_two", url: "https://files.example/two.png" },
      { index: 2, fileId: "file_three", url: "https://files.example/three.png" },
    ],
  }));
  assert.equal(document.querySelector("#visual img").src, "https://files.example/one.png");

  document.querySelector("#next").click();
  assert.equal(document.querySelector("#counter").textContent, "Slide 2 of 3");
  assert.equal(document.querySelector("#progress-shell").getAttribute("aria-valuenow"), "2");
});

test("widget keeps the complete educational image visible inside its frame", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult());

  const image = dom.window.document.querySelector("#visual img");
  assert.equal(dom.window.getComputedStyle(image).objectFit, "contain");
});

test("widget hides the entire lesson when a required slide image cannot load", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult({
    slides: [
      { id: "one", number: 1, title: "Wings", body: "Wings push air.", imageIndex: 0 },
      { id: "two", number: 2, title: "Lift", body: "Lift pushes up.", imageIndex: 1 },
      { id: "three", number: 3, title: "Steering", body: "Tails steer.", imageIndex: 2 },
    ],
    images: [
      { index: 0, fileId: "file_one", url: "https://files.example/one.png" },
      { index: 1, fileId: "file_two", url: "https://files.example/two.png" },
      { index: 2, fileId: "file_three", url: "https://files.example/three.png" },
    ],
  }));
  dom.window.document.querySelector("#visual img").dispatchEvent(new dom.window.Event("error"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector("#lesson").hidden, true);
  assert.equal(dom.window.document.querySelector("#empty").hidden, false);
  assert.match(dom.window.document.querySelector("#empty-message").textContent, /image could not be displayed/i);
  assert.match(dom.window.document.querySelector("#empty-message").textContent, /https:\/\/files\.example/);
});

test("widget labels diagram lessons without inserting SVG and still fails the whole lesson on image rejection", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult({ visualMode: "diagram" }));
  const document = dom.window.document;
  assert.equal(document.querySelector("#diagram-notice").textContent, "Illustrative diagrams");
  assert.equal(document.querySelector("#diagram-notice").hidden, false);
  assert.equal(document.querySelectorAll("svg").length, 0);

  document.querySelector("#visual img").dispatchEvent(new dom.window.Event("error"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(document.querySelector("#lesson").hidden, true);
  assert.equal(document.querySelector("#empty").hidden, false);
});

test("widget offers a new session only for diagram lessons without blocking navigation", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  const document = dom.window.document;
  await deliver(dom, lessonResult({ visualMode: "diagram" }));
  const hint = document.querySelector("#diagram-work-hint");
  assert.ok(hint, "diagram lesson exposes a new-session suggestion");
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Chat or Work session.*may be available.*neither mode guarantees/);
  document.querySelector("#next").click();
  assert.equal(document.querySelector("#counter").textContent, "Slide 2 of 3");
  await deliver(dom, lessonResult());
  assert.equal(hint.hidden, true);
  await deliver(dom, lessonResult({ visualMode: "native" }));
  assert.equal(hint.hidden, true);
});

test("widget hides the entire lesson when a required slide image is absent", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult({
    slides: [
      { id: "one", number: 1, title: "Wings", body: "Wings push air.", imageIndex: 0 },
      { id: "two", number: 2, title: "Lift", body: "Lift pushes up.", imageIndex: 1 },
      { id: "three", number: 3, title: "Steering", body: "Tails steer.", imageIndex: 2 },
    ],
    images: [],
  }));
  assert.equal(dom.window.document.querySelector("#lesson").hidden, true);
  assert.equal(dom.window.document.querySelector("#empty").hidden, false);
  assert.match(dom.window.document.querySelector("#empty-message").textContent, /required lesson image/i);
  assert.equal(dom.window.document.querySelector(".image-placeholder"), null);
});

test("widget renders safe image credits for attributed public visuals", async (t) => {
  const { dom } = await loadWidget();
  t.after(() => dom.window.close());
  await deliver(dom, lessonResult({
    images: [
      {
        index: 0,
        url: "https://lesson.example/api/images/one",
        title: "Wing diagram",
        creator: "Aviation Teacher",
        licenseName: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Wing_diagram.png",
        sourceOrganization: "Wikimedia Commons",
      },
      {
        index: 1,
        url: "https://lesson.example/api/images/two",
        title: '<img src=x onerror="window.creditInjected=true">',
        licenseName: "Public domain",
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Lift.png",
      },
      {
        index: 2,
        url: "https://lesson.example/api/images/three",
        title: "Tail feathers",
        creator: "Example artist",
        licenseName: "CC0 1.0",
        licenseUrl: "javascript:alert(1)",
        sourcePageUrl: "not-a-url",
      },
    ],
  }));

  const document = dom.window.document;
  const credits = document.querySelector("#image-credits");
  assert.equal(credits.hidden, false);
  assert.equal(document.querySelectorAll("#image-credit-list li").length, 3);
  assert.match(document.querySelector("#image-credit-list li").textContent, /^Wings:/);
  assert.match(document.querySelector("#image-credit-list").textContent, /Aviation Teacher.*CC BY 4\.0.*Wikimedia Commons/s);
  assert.match(document.querySelector("#image-credit-list").textContent, /<img src=x onerror=/);
  assert.equal(dom.window.creditInjected, undefined);
  const links = [...document.querySelectorAll("#image-credit-list a")];
  assert.ok(links.every((link) => ["http:", "https:"].includes(new URL(link.href).protocol)));
  assert.equal(links.some((link) => link.href.startsWith("javascript:")), false);
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
