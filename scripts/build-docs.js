import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReceipt, renderReceiptHtml, renderReceiptSvg } from "../src/index.js";

const input = JSON.parse(await readFile(new URL("../examples/launch-window.input.json", import.meta.url), "utf8"));
const receipt = createReceipt(input);
await mkdir(new URL("../docs/generated/", import.meta.url), { recursive: true });
await writeFile(new URL("../examples/launch-window.jevreceipt.json", import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(new URL("../docs/index.html", import.meta.url), renderReceiptHtml(receipt));
await writeFile(new URL("../docs/generated/launch-window.svg", import.meta.url), renderReceiptSvg(receipt));
