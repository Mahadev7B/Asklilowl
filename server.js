import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lessonHtml = readFileSync(
  path.join(__dirname, "public", "lesson-widget.html"),
  "utf8"
);
const testBirdSvg = readFileSync(
  path.join(__dirname, "public", "test-bird.svg"),
  "utf8"
);

const LESSON_URI = "ui://asklilowl/lesson.html";
const MCP_PATH = "/mcp";
const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN ?? "https://asklilowl-chatgpt.onrender.com"
).replace(/\/+$/, "");

const slideSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  funFact: z.string().optional(),
  imageAlt: z.string().optional(),
  imageIndex: z.number().int().nonnegative().optional(),
});

const quizQuestionSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(6),
  answerIndex: z.number().int().nonnegative(),
  explanation: z.string().optional(),
});

function normalizeImages(input) {
  const images = Array.isArray(input) ? input : input ? [input] : [];

  return images.map((image, index) => {
    if (typeof image === "string") {
      return {
        index,
        fileId: image.startsWith("file_") || image.startsWith("file-") ? image : null,
        url: /^https?:\/\//i.test(image) || image.startsWith("data:") ? image : null,
        mimeType: null,
        fileName: `lesson-image-${index + 1}`,
        size: null,
      };
    }

    return {
      index,
      fileId: image?.file_id ?? image?.fileId ?? null,
      url: image?.download_url ?? image?.downloadUrl ?? image?.url ?? null,
      mimeType: image?.mime_type ?? image?.mimeType ?? null,
      fileName:
        image?.file_name ??
        image?.fileName ??
        image?.name ??
        `lesson-image-${index + 1}`,
      size: image?.size ?? null,
    };
  });
}

function createAskLilOwlServer() {
  const server = new McpServer({
    name: "asklilowl-plugin-server",
    version: "0.1.4",
  });

  registerAppResource(
    server,
    "AskLilOwl lesson player",
    LESSON_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive AskLilOwl visual lesson and quiz player.",
    },
    async () => ({
      contents: [
        {
          uri: LESSON_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: lessonHtml,
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [
                  PUBLIC_ORIGIN,
                  "https://images.pexels.com",
                  "https://*.oaiusercontent.com"
                ],
              },
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "create_lesson",
    {
      title: "Create AskLilOwl lesson",
      description:
        "Render a complete interactive AskLilOwl lesson that YOU have already researched, reasoned through, and written using the strongest capabilities available in the current ChatGPT conversation. " +
        "Do not assume or request a specific host model; use the model and native capabilities ChatGPT currently provides to the user. " +
        "For current, changing, scientific, historical, or otherwise factual topics, verify important facts with ChatGPT's available research/search tools before teaching them when those tools are available; if verification is unavailable and a fact is uncertain, avoid presenting it as certain. " +
        "Adapt vocabulary, examples, pacing, and quiz difficulty to the requested learner level. " +
        "Choose the slide count dynamically from the topic and requested depth; do not force four slides. " +
        "Typical guidance: 4-5 for simple topics, 6-8 for moderate topics, 9-12 for complex topics, and up to 20 for a deep dive. " +
        "Use the minimum number of slides needed for a clear explanation and create an age/skill-appropriate quiz. " +
        "When native ChatGPT image generation is available, generate useful educational illustrations before calling this tool and pass those ChatGPT-managed image files in the images parameter. " +
        "Prefer images that directly teach the slide concept rather than decorative pictures. Each slide can point to one image with imageIndex. " +
        "Do not call an external language model, image provider, or TTS provider from this tool. The AskLilOwl backend should only render the lesson content and files ChatGPT supplies.",
      inputSchema: {
        topic: z.string().min(1).describe("The topic or question being explained."),
        title: z.string().min(1).describe("Short lesson title."),
        audience: z
          .string()
          .min(1)
          .describe("Intended learner level, such as young learner, teen, adult, or expert."),
        depth: z
          .enum(["quick", "standard", "deep"])
          .default("standard")
          .describe("Requested lesson depth."),
        summary: z
          .string()
          .optional()
          .describe("One-sentence overview of what the learner will understand."),
        slides: z
          .array(slideSchema)
          .min(3)
          .max(20)
          .describe("Dynamically sized lesson slides, written for the requested learner level."),
        quiz: z
          .array(quizQuestionSchema)
          .min(1)
          .max(10)
          .describe("Short multiple-choice comprehension quiz matched to the lesson and learner level."),
        images: z
          .any()
          .optional()
          .describe(
            "ChatGPT-managed educational image file input generated or supplied in the current ChatGPT conversation. ChatGPT may supply one file object or an array of file objects."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: LESSON_URI },
        "openai/fileParams": ["images"],
      },
    },
    async (args) => {
      const images = normalizeImages(args.images);
      const slides = args.slides.map((slide, index) => ({
        ...slide,
        number: index + 1,
        imageIndex:
          typeof slide.imageIndex === "number" && slide.imageIndex < images.length
            ? slide.imageIndex
            : images[index]
              ? index
              : null,
      }));

      const invalidQuiz = args.quiz.find(
        (item) => item.answerIndex < 0 || item.answerIndex >= item.choices.length
      );

      if (invalidQuiz) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "A quiz question has an answerIndex outside its choices array. Please regenerate that question and call create_lesson again.",
            },
          ],
        };
      }

      const lesson = {
        topic: args.topic,
        title: args.title,
        audience: args.audience,
        depth: args.depth,
        summary: args.summary ?? "",
        slideCount: slides.length,
        slides,
        quiz: args.quiz,
        images,
      };

      return {
        content: [
          {
            type: "text",
            text: `AskLilOwl prepared “${args.title}” with ${slides.length} slides and ${args.quiz.length} quiz question${args.quiz.length === 1 ? "" : "s"}.`,
          },
        ],
        structuredContent: { lesson },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("AskLilOwl MCP server is running. Use /mcp from ChatGPT or MCP Inspector.");
    return;
  }

  if (req.method === "GET" && url.pathname === "/test-bird.svg") {
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(testBirdSvg);
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAskLilOwlServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`AskLilOwl MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
