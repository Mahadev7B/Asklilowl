import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function validateEvalCorpus(corpus) {
  const errors = [];
  if (!corpus || typeof corpus !== "object") {
    return { errors: ["Corpus must be a JSON object."] };
  }
  if (typeof corpus.version !== "string" || !corpus.version.trim()) {
    errors.push("Corpus version is required.");
  }
  if (!Array.isArray(corpus.cases)) {
    return { errors: [...errors, "Corpus cases must be an array."] };
  }

  const ids = new Set();
  let positiveCount = 0;
  let negativeCount = 0;

  corpus.cases.forEach((item, index) => {
    const at = `cases[${index}]`;
    if (!item || typeof item !== "object") {
      errors.push(`${at} must be an object.`);
      return;
    }
    if (typeof item.id !== "string" || !/^[a-z0-9-]+$/.test(item.id)) {
      errors.push(`${at}.id must use lowercase letters, digits, and hyphens.`);
    } else if (ids.has(item.id)) {
      errors.push(`${at}.id duplicates ${item.id}.`);
    } else {
      ids.add(item.id);
    }
    if (item.type === "positive") positiveCount += 1;
    else if (item.type === "negative") negativeCount += 1;
    else errors.push(`${at}.type must be positive or negative.`);

    if (typeof item.prompt !== "string" || item.prompt.trim().length < 10) {
      errors.push(`${at}.prompt must be a realistic prompt.`);
    }
    if (!Array.isArray(item.tags) || item.tags.length === 0) {
      errors.push(`${at}.tags must contain at least one tag.`);
    }
    if (!item.expected || typeof item.expected !== "object") {
      errors.push(`${at}.expected is required.`);
      return;
    }

    if (item.type === "positive") {
      if (item.expected.toolDecision !== "call") {
        errors.push(`${at} positive case must expect a tool call.`);
      }
      if (item.expected.toolName !== "create_lesson") {
        errors.push(`${at} positive case must call create_lesson.`);
      }
      if (!item.expected.audience || !item.expected.depth) {
        errors.push(`${at} positive case must define audience and depth.`);
      }
      if (typeof item.expected.requiresFreshResearch !== "boolean") {
        errors.push(`${at} must declare whether fresh research is required.`);
      }
    }

    if (item.type === "negative") {
      if (item.expected.toolDecision !== "do_not_call") {
        errors.push(`${at} negative case must reject the tool call.`);
      }
      if (typeof item.expected.reason !== "string" || !item.expected.reason.trim()) {
        errors.push(`${at} negative case must explain why.`);
      }
    }
  });

  if (positiveCount < 5) errors.push("Corpus needs at least five positive cases.");
  if (negativeCount < 3) errors.push("Corpus needs at least three negative cases.");
  return { errors };
}

async function main() {
  const evalUrl = new URL("../evals/cases.json", import.meta.url);
  const corpus = JSON.parse(await readFile(evalUrl, "utf8"));
  const { errors } = validateEvalCorpus(corpus);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${corpus.cases.length} AskLilOwl evaluation cases.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
