# Jev Decision Receipts

[![test](https://github.com/gbesse/jev-decision-receipts/actions/workflows/test.yml/badge.svg)](https://github.com/gbesse/jev-decision-receipts/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-8dffcf.svg)](LICENSE)

**Make any human or agent decision inspectable, portable, and shareable.**

A `.jevreceipt.json` captures the finite choices, weighted criteria, evidence references, deterministic ranking, abstention reasons, provenance, source revision, and a SHA-256 integrity seal. It also renders as a self-contained HTML viewer or social card.

## Why this exists

Agents can produce an answer faster than a team can review how it was reached. A Decision Receipt is the missing handoff artifact: small enough for a pull request, durable enough for an audit, and visual enough to share.

It deliberately does **not** claim that cited evidence is true. It proves what inputs and method produced a verdict, detects mutation, and makes missing evidence visible.

## 30-second demo

```bash
git clone https://github.com/gbesse/jev-decision-receipts.git
cd jev-decision-receipts
npm run build:docs
node src/cli.js validate examples/launch-window.jevreceipt.json
node src/cli.js card examples/launch-window.jevreceipt.json launch-window.svg
```

No dependency, API key, account, or network request is required.

## Commands

```text
jev-receipt create input.json [receipt.jevreceipt.json]
jev-receipt validate receipt.jevreceipt.json
jev-receipt render receipt.jevreceipt.json [receipt.html]
jev-receipt card receipt.jevreceipt.json [receipt.svg]
```

## Design guarantees

- Finite choice set: 2–32 candidate IDs, recorded in the artifact.
- Deterministic result: weighted scores are code-owned, not narrated by a model.
- Honest uncertainty: insufficient coverage or a narrow margin yields `abstained`.
- Revision binding: every receipt names the source revision it judged.
- Portable integrity: canonical JSON is sealed with SHA-256.
- Safe sharing: HTML and SVG output escapes user-controlled text and loads no remote scripts.

See the [v1 JSON Schema](schema/jev-receipt-v1.schema.json) and [worked fixture](examples/launch-window.jevreceipt.json).

## JavaScript API

```js
import { createReceipt, validateReceipt, renderReceiptSvg } from "jev-decision-receipts";

const receipt = createReceipt({
  subject: "Ship today?",
  revision: "git:abc123",
  producer: { name: "release-bot", version: "1.0.0" },
  candidates: [{ id: "ship", label: "Ship" }, { id: "wait", label: "Wait" }],
  criteria: [{ id: "readiness", label: "Readiness", weight: 1 }],
  evaluations: [
    { candidateId: "ship", criterionId: "readiness", score: 91 },
    { candidateId: "wait", criterionId: "readiness", score: 55 }
  ]
});

validateReceipt(receipt); // { valid: true, errors: [] }
```

## Ecosystem

The first producer is [Jev Agent Draft](https://github.com/gbesse/jev-agent-draft), a portable ChatGPT/Codex plugin that compares agents, MCP servers, and skills before installation.

## License

MIT
