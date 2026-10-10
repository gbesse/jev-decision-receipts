#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createReceipt, renderReceiptHtml, renderReceiptSvg, validateReceipt } from "./index.js";

const [command, inputPath, outputPath] = process.argv.slice(2);
const usage = "Usage: jev-receipt <create|validate|render|card> <input.json> [output]";
if (!command || !inputPath) { console.error(usage); process.exit(2); }

try {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  if (command === "create") {
    const receipt = createReceipt(input);
    const output = outputPath ?? `${basename(inputPath, ".json")}.jevreceipt.json`;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(output);
  } else if (command === "validate") {
    const result = validateReceipt(input);
    if (!result.valid) { console.error(result.errors.join("\n")); process.exit(1); }
    console.log(`valid ${input.id}`);
  } else if (command === "render" || command === "card") {
    const result = validateReceipt(input);
    if (!result.valid) throw new Error(result.errors.join("; "));
    const output = outputPath ?? `${basename(inputPath, ".jevreceipt.json")}.${command === "card" ? "svg" : "html"}`;
    await writeFile(output, command === "card" ? renderReceiptSvg(input) : renderReceiptHtml(input));
    console.log(output);
  } else {
    console.error(usage); process.exit(2);
  }
} catch (error) {
  console.error(error.message); process.exit(1);
}
