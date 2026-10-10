import { createHash } from "node:crypto";

export const RECEIPT_SCHEMA = "https://jev.dev/schemas/decision-receipt/v1";
export const RECEIPT_VERSION = "1.0.0";

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Non-finite numbers cannot be canonicalized");
  if (value === undefined) throw new TypeError("Undefined values cannot be canonicalized");
  return JSON.stringify(value);
}

function payloadForIntegrity(receipt) {
  const clone = structuredClone(receipt);
  delete clone.integrity;
  delete clone.id;
  return clone;
}

export function digestReceipt(receipt) {
  return createHash("sha256").update(canonicalize(payloadForIntegrity(receipt))).digest("hex");
}

function isId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
}

function assertFiniteSet(items, label, min, max) {
  if (!Array.isArray(items) || items.length < min || items.length > max) {
    throw new TypeError(`${label} must contain ${min}-${max} items`);
  }
  const ids = items.map((item) => item.id);
  if (ids.some((id) => !isId(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} ids must be unique, portable identifiers`);
  }
}

export function rankDecision({ candidates, criteria, evaluations, minimumCoverage = 0.75, minimumMargin = 0.03 }) {
  assertFiniteSet(candidates, "candidates", 2, 32);
  assertFiniteSet(criteria, "criteria", 1, 32);
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!(totalWeight > 0) || criteria.some((criterion) => !Number.isFinite(criterion.weight) || criterion.weight <= 0)) {
    throw new TypeError("criterion weights must be finite positive numbers");
  }
  const byPair = new Map();
  for (const evaluation of evaluations ?? []) {
    if (!Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 100) {
      throw new TypeError("evaluation scores must be between 0 and 100");
    }
    const key = `${evaluation.candidateId}\u0000${evaluation.criterionId}`;
    if (byPair.has(key)) throw new TypeError(`duplicate evaluation for ${evaluation.candidateId}/${evaluation.criterionId}`);
    byPair.set(key, evaluation);
  }
  const ranking = candidates.map((candidate) => {
    let weighted = 0;
    let coveredWeight = 0;
    for (const criterion of criteria) {
      const evaluation = byPair.get(`${candidate.id}\u0000${criterion.id}`);
      if (!evaluation) continue;
      const direction = criterion.direction ?? "maximize";
      const normalized = direction === "minimize" ? 100 - evaluation.score : evaluation.score;
      weighted += normalized * criterion.weight;
      coveredWeight += criterion.weight;
    }
    return {
      candidateId: candidate.id,
      score: coveredWeight ? Number((weighted / coveredWeight).toFixed(4)) : 0,
      coverage: Number((coveredWeight / totalWeight).toFixed(4))
    };
  }).sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.candidateId.localeCompare(b.candidateId));
  const leader = ranking[0];
  const runnerUp = ranking[1];
  const reasons = [];
  if (leader.coverage < minimumCoverage) reasons.push(`coverage ${leader.coverage} is below ${minimumCoverage}`);
  const margin = (leader.score - runnerUp.score) / 100;
  if (margin < minimumMargin) reasons.push(`margin ${margin.toFixed(4)} is below ${minimumMargin}`);
  return reasons.length ? { status: "abstained", ranking, reasons } : {
    status: "selected",
    candidateId: leader.candidateId,
    confidence: Number(Math.min(1, leader.coverage * (0.5 + margin)).toFixed(4)),
    ranking,
    reasons: [`${leader.candidateId} leads by ${(margin * 100).toFixed(2)} points with ${(leader.coverage * 100).toFixed(0)}% evidence coverage`]
  };
}

export function createReceipt(input) {
  const candidates = structuredClone(input.candidates);
  const criteria = structuredClone(input.criteria);
  const evaluations = structuredClone(input.evaluations ?? []);
  const receipt = {
    $schema: RECEIPT_SCHEMA,
    version: RECEIPT_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    subject: input.subject,
    revision: input.revision,
    producer: structuredClone(input.producer),
    candidates,
    criteria,
    evaluations,
    verdict: rankDecision({ candidates, criteria, evaluations, minimumCoverage: input.minimumCoverage, minimumMargin: input.minimumMargin }),
    provenance: structuredClone(input.provenance ?? { method: "weighted-sum", generatedBy: "software" })
  };
  if (input.humanChoice) receipt.humanChoice = structuredClone(input.humanChoice);
  if (input.outcome) receipt.outcome = structuredClone(input.outcome);
  const digest = digestReceipt(receipt);
  receipt.id = `jvr_${digest.slice(0, 20)}`;
  receipt.integrity = { algorithm: "sha256", digest };
  return receipt;
}

export function validateReceipt(receipt, { verifyIntegrity = true } = {}) {
  const errors = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { valid: false, errors: ["receipt must be an object"] };
  if (receipt.$schema !== RECEIPT_SCHEMA) errors.push("unsupported $schema");
  if (receipt.version !== RECEIPT_VERSION) errors.push("unsupported version");
  if (typeof receipt.subject !== "string" || !receipt.subject.trim()) errors.push("subject is required");
  if (typeof receipt.revision !== "string" || !receipt.revision.trim()) errors.push("revision is required");
  try { assertFiniteSet(receipt.candidates, "candidates", 2, 32); } catch (error) { errors.push(error.message); }
  try { assertFiniteSet(receipt.criteria, "criteria", 1, 32); } catch (error) { errors.push(error.message); }
  try {
    const candidateIds = new Set(receipt.candidates.map((candidate) => candidate.id));
    const rankedIds = receipt.verdict?.ranking?.map((item) => item.candidateId) ?? [];
    if (rankedIds.length !== candidateIds.size || new Set(rankedIds).size !== rankedIds.length || rankedIds.some((id) => !candidateIds.has(id))) {
      errors.push("verdict ranking must contain every candidate exactly once");
    }
    if (receipt.verdict?.status === "selected" && !candidateIds.has(receipt.verdict.candidateId)) errors.push("selected candidate is not in the finite choice set");
    if (receipt.provenance?.method === "weighted-sum") {
      const recalculated = rankDecision({ candidates: receipt.candidates, criteria: receipt.criteria, evaluations: receipt.evaluations });
      if (receipt.verdict?.status !== recalculated.status || canonicalize(receipt.verdict?.ranking) !== canonicalize(recalculated.ranking)) {
        errors.push("verdict does not match deterministic ranking");
      }
    }
  } catch (error) { errors.push(error.message); }
  if (verifyIntegrity) {
    const digest = digestReceipt(receipt);
    if (receipt.integrity?.algorithm !== "sha256" || receipt.integrity?.digest !== digest) errors.push("integrity digest mismatch");
    if (receipt.id !== `jvr_${digest.slice(0, 20)}`) errors.push("receipt id mismatch");
  }
  return { valid: errors.length === 0, errors };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function renderReceiptSvg(receipt) {
  const winner = receipt.verdict.status === "selected" ? receipt.candidates.find((c) => c.id === receipt.verdict.candidateId)?.label : "ABSTAINED";
  const rows = receipt.verdict.ranking.slice(0, 4).map((item, index) => {
    const label = receipt.candidates.find((candidate) => candidate.id === item.candidateId)?.label ?? item.candidateId;
    const y = 260 + index * 58;
    const width = Math.max(2, item.score * 6.2);
    return `<text x="80" y="${y}" fill="#dce7ff" font-size="24">${escapeHtml(label)}</text><rect x="350" y="${y - 20}" width="${width}" height="22" rx="11" fill="${index === 0 ? "#8dffcf" : "#6681a8"}"/><text x="1000" y="${y}" text-anchor="end" fill="#dce7ff" font-size="22">${item.score.toFixed(1)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#08111f"/><stop offset="1" stop-color="#152747"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="1080" cy="90" r="180" fill="#8dffcf" opacity=".08"/><text x="80" y="82" fill="#8dffcf" font-family="ui-monospace,monospace" font-size="23" letter-spacing="4">JEV DECISION RECEIPT</text><text x="80" y="145" fill="white" font-family="system-ui,sans-serif" font-weight="700" font-size="40">${escapeHtml(receipt.subject)}</text><text x="80" y="202" fill="#9eb2d2" font-family="system-ui,sans-serif" font-size="25">Verdict: ${escapeHtml(winner)}</text><g font-family="system-ui,sans-serif">${rows}</g><line x1="80" y1="532" x2="1120" y2="532" stroke="#354969"/><text x="80" y="578" fill="#91a6c5" font-family="ui-monospace,monospace" font-size="18">${escapeHtml(receipt.id)} · SHA-256 VERIFIED</text><text x="1120" y="578" text-anchor="end" fill="#8dffcf" font-family="system-ui,sans-serif" font-size="20">jev.dev/receipts</text></svg>`;
}

export function renderReceiptHtml(receipt) {
  const validation = validateReceipt(receipt);
  const card = renderReceiptSvg(receipt);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(receipt.subject)} — Jev Receipt</title><style>body{margin:0;background:#060b13;color:#edf5ff;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.wrap{width:min(1100px,92vw)}svg{width:100%;height:auto;border-radius:22px;box-shadow:0 24px 80px #0008}pre{background:#0e1828;padding:20px;border-radius:14px;overflow:auto;color:#a9bbd6}.ok{color:#8dffcf}.bad{color:#ff9d9d}</style><main class="wrap">${card}<p class="${validation.valid ? "ok" : "bad"}">${validation.valid ? "✓ Integrity verified" : `⚠ ${escapeHtml(validation.errors.join("; "))}`}</p><details><summary>Portable receipt JSON</summary><pre>${escapeHtml(JSON.stringify(receipt, null, 2))}</pre></details></main></html>`;
}
