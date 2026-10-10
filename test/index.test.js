import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, createReceipt, digestReceipt, rankDecision, renderReceiptHtml, renderReceiptSvg, validateReceipt } from "../src/index.js";

const input = {
  createdAt: "2026-10-10T09:00:00.000Z", subject: "Pick", revision: "r1",
  producer: { name: "test", version: "1" },
  candidates: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  criteria: [{ id: "quality", label: "Quality", weight: 2 }, { id: "cost", label: "Cost", weight: 1, direction: "minimize" }],
  evaluations: [
    { candidateId: "a", criterionId: "quality", score: 90 }, { candidateId: "a", criterionId: "cost", score: 30 },
    { candidateId: "b", criterionId: "quality", score: 70 }, { candidateId: "b", criterionId: "cost", score: 20 }
  ]
};

test("canonicalization sorts object keys", () => assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}'));
test("canonicalization rejects non-finite numbers", () => assert.throws(() => canonicalize(Infinity), /Non-finite/));
test("creates a deterministic receipt", () => assert.deepEqual(createReceipt(input), createReceipt(input)));
test("selects the weighted leader", () => assert.equal(createReceipt(input).verdict.candidateId, "a"));
test("supports minimize criteria", () => assert.equal(createReceipt(input).verdict.ranking[1].score, 73.3333));
test("abstains on incomplete evidence", () => {
  const verdict = rankDecision({ ...input, evaluations: input.evaluations.slice(0, 1) });
  assert.equal(verdict.status, "abstained");
});
test("abstains on a tie", () => {
  const tied = structuredClone(input); tied.evaluations[2].score = 90; tied.evaluations[3].score = 30;
  assert.equal(createReceipt(tied).verdict.status, "abstained");
});
test("validates an intact receipt", () => assert.equal(validateReceipt(createReceipt(input)).valid, true));
test("detects tampering", () => {
  const receipt = createReceipt(input); receipt.subject = "Tampered";
  assert.match(validateReceipt(receipt).errors.join(" "), /integrity/);
});
test("detects forged ranking", () => {
  const receipt = createReceipt(input); receipt.verdict.ranking.reverse();
  assert.match(validateReceipt(receipt, { verifyIntegrity: false }).errors.join(" "), /ranking/);
});
test("accepts a sealed producer-specific method", () => {
  const receipt = createReceipt(input);
  receipt.provenance.method = "hard-gates+weighted-sum";
  receipt.verdict.ranking[0].eligible = true;
  receipt.integrity.digest = digestReceipt(receipt);
  receipt.id = `jvr_${receipt.integrity.digest.slice(0, 20)}`;
  assert.equal(validateReceipt(receipt).valid, true);
});
test("rejects duplicate candidate ids", () => assert.throws(() => createReceipt({ ...input, candidates: [{ id: "a" }, { id: "a" }] }), /unique/));
test("rejects out-of-range scores", () => assert.throws(() => createReceipt({ ...input, evaluations: [{ candidateId: "a", criterionId: "quality", score: 101 }] }), /between/));
test("digest ignores stored integrity", () => { const r = createReceipt(input); assert.equal(digestReceipt(r), r.integrity.digest); });
test("renders escaped share assets", () => {
  const receipt = createReceipt({ ...input, subject: "Pick <now>" });
  assert.match(renderReceiptSvg(receipt), /Pick &lt;now&gt;/);
  assert.match(renderReceiptHtml(receipt), /Integrity verified/);
});
