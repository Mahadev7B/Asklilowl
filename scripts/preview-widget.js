import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { getDemoLesson } from "../demo-fixtures.js";

const port = Number(process.env.PREVIEW_PORT ?? 8790);
const origin = `http://127.0.0.1:${port}`;
const widgetUrl = new URL("../public/lesson-widget.html", import.meta.url);
const birdUrl = new URL("../public/test-bird.svg", import.meta.url);
const widget = await readFile(widgetUrl, "utf8");
const bird = await readFile(birdUrl, "utf8");
const lesson = getDemoLesson("birds-young-learner", { publicOrigin: origin });
const payload = JSON.stringify({ structuredContent: { lesson } }).replaceAll(
  "<",
  "\\u003c"
);
const preview = widget.replace(
  "</body>",
  `<script>setTimeout(() => window.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:${payload}}, "*"), 100);</script></body>`
);

const server = createServer((request, response) => {
  if (request.url === "/test-bird.svg") {
    response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" });
    response.end(bird);
    return;
  }
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(preview);
    return;
  }
  response.writeHead(404).end("Not Found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AskLilOwl widget preview: ${origin}`);
});
