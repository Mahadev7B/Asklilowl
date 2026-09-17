// Offline browser regression fixture. No providers, tokens, or paid API calls.
// Open the printed URL; PASS requires the real rendered image to fit its frame.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { getDemoLesson } from "../demo-fixtures.js";
import { createAskLilOwlHttpServer } from "../server.js";

const port = Number(process.env.LAYOUT_PORT ?? 8794);
const lesson = getDemoLesson("birds-young-learner", { publicOrigin: `http://127.0.0.1:${port}` });
lesson.images = lesson.slides.map((_, index) => ({ index, url: "/square.png" }));
lesson.slides.forEach((slide, index) => { slide.imageIndex = index; slide.audioCueSeconds = index * 2; });
lesson.audioUrl = `http://127.0.0.1:${port}/api/assets/offline-silence`;
lesson.voice = { available: true, disclosure: "Offline silent audio fixture — no API." };
// Ten seconds of silent PCM WAV tests actual browser seeking, not a media mock.
const wav = Buffer.alloc(44 + 160000);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(160000, 40);
const assetServer = createAskLilOwlHttpServer({ audioService: {
  resolve: id => id === "offline-silence" ? { bytes: wav, contentType: "audio/wav" } : null,
} });
const widget = readFileSync(new URL("../public/lesson-widget.html", import.meta.url), "utf8");
const raster = readFileSync(new URL("../assets/asklilowl-icon.png", import.meta.url));
const check = `<script>
setTimeout(() => window.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:${JSON.stringify({ structuredContent: { lesson } }).replaceAll("<", "\\u003c")}}, "*"), 100);
setTimeout(() => {
  const img = document.querySelector(".visual img");
  const frame = img?.parentElement;
  const fits = img?.complete && img.naturalWidth > 0 && img.clientWidth <= frame.clientWidth + 1 && img.clientHeight <= frame.clientHeight + 1;
  const result = document.createElement("p");
  result.id = "layout-regression-result";
  result.setAttribute("role", "status");
  result.textContent = (fits ? "PASS" : "FAIL") + ": image " + img?.clientWidth + "x" + img?.clientHeight + "; frame " + frame?.clientWidth + "x" + frame?.clientHeight;
  document.body.prepend(result);
}, 1200);
</script>`;
const server = createServer((req, res) => {
  if (req.url.startsWith("/api/assets/")) {
    assetServer.emit("request", req, res);
  } else if (req.url === "/square.png") {
    res.writeHead(200, { "content-type": "image/png" }).end(raster);
  } else if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" }).end(widget.replace("</body>", check + "</body>"));
  } else res.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => console.log(`Offline layout check: http://127.0.0.1:${port}`));
