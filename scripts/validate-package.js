import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function readJson(url, errors) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    errors.push(`${fileURLToPath(url)}: ${error.message}`);
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function inspectPng(rootPath, relativePath, minimum, errors) {
  const normalized = relativePath.replace(/^\.\//, "");
  const absolute = path.resolve(rootPath, normalized);
  if (!absolute.startsWith(`${rootPath}${path.sep}`)) {
    errors.push(`${relativePath} escapes the plugin root.`);
    return null;
  }
  try {
    const info = await stat(absolute);
    const bytes = await readFile(absolute);
    const signature = bytes.subarray(0, 8).toString("hex");
    if (signature !== "89504e470d0a1a0a") {
      errors.push(`${relativePath} is not a PNG file.`);
      return null;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < minimum || height < minimum) {
      errors.push(`${relativePath} must be at least ${minimum}x${minimum}.`);
    }
    if (info.size > 5 * 1024 * 1024) {
      errors.push(`${relativePath} exceeds 5 MiB.`);
    }
    return { dimensions: [width, height], bytes: info.size };
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

export async function validatePluginPackage(rootUrl) {
  const errors = [];
  const rootPath = path.resolve(fileURLToPath(rootUrl));
  const portable = await readJson(new URL("plugin.json", rootUrl), errors);
  const mcp = await readJson(new URL("mcp.json", rootUrl), errors);
  const compatibility = await readJson(
    new URL(".codex-plugin/plugin.json", rootUrl),
    errors
  );
  const assets = {};

  for (const file of [
    "diagram-worker.js",
    "assets/fonts/NotoSans-Regular.ttf",
    "assets/fonts/OFL.txt",
  ]) {
    if (!existsSync(new URL(file, rootUrl))) {
      errors.push(`Required package file is missing: ${file}.`);
    }
  }

  if (portable) {
    if (
      portable.$schema !==
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    ) {
      errors.push("plugin.json uses an unsupported schema URL.");
    }
    if (portable.name !== "asklilowl") errors.push("Portable name must be asklilowl.");
    if (!/^\d+\.\d+\.\d+$/.test(portable.version ?? "")) {
      errors.push("Portable version must be semantic versioning.");
    }
    const ui = portable.extensions?.["com.openai"]?.interface;
    if (!ui) {
      errors.push("OpenAI interface metadata is required.");
    } else {
      for (const key of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
        if (!isHttpsUrl(ui[key])) errors.push(`${key} must be an HTTPS URL.`);
      }
      if (!Array.isArray(ui.defaultPrompt) || ui.defaultPrompt.length > 3) {
        errors.push("defaultPrompt must contain at most three prompts.");
      } else if (ui.defaultPrompt.some((prompt) => prompt.length > 128)) {
        errors.push("Starter prompts must be at most 128 characters.");
      }
      for (const [field, minimum] of [
        ["composerIcon", 64],
        ["logo", 512],
      ]) {
        if (typeof ui[field] !== "string") {
          errors.push(`${field} must reference a local PNG.`);
          continue;
        }
        const details = await inspectPng(rootPath, ui[field], minimum, errors);
        if (details) assets[ui[field]] = details;
      }
    }
  }

  if (mcp) {
    if (
      mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
    ) {
      errors.push("mcp.json uses an unsupported schema URL.");
    }
    const endpoint = mcp.mcpServers?.asklilowl;
    if (endpoint?.type !== "streamable-http") {
      errors.push("AskLilOwl MCP transport must be streamable-http.");
    }
    if (!isHttpsUrl(endpoint?.url) || !endpoint.url.endsWith("/mcp")) {
      errors.push("AskLilOwl MCP URL must be an HTTPS /mcp endpoint.");
    }
  }

  if (portable && compatibility) {
    if (portable.name !== compatibility.name) {
      errors.push("Portable and compatibility names differ.");
    }
    if (portable.version !== compatibility.version) {
      errors.push("Portable and compatibility versions differ.");
    }
  }

  return { errors, assets };
}

async function main() {
  const rootUrl = new URL("../", import.meta.url);
  const result = await validatePluginPackage(rootUrl);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated AskLilOwl plugin package with ${Object.keys(result.assets).length} raster assets.`);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
