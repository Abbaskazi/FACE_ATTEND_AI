// TEST-ONLY recognition experiment.
//
// This file is deliberately isolated from Android, Edge Functions, migrations,
// RPCs, and attendance code. It reads only aggregate similarity scores from
// the linked database; it never retrieves or prints embedding vectors.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "hpckuuxuvpkysadqiicy";
export const MODEL_NAME = "w600k_mbf.onnx";
export const MODEL_VERSION = "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f";
export const EMBEDDING_DIMENSION = 512;
export const THRESHOLD = 0.60;
export const AMBIGUITY_MARGIN = 0.08;

function assertFiniteScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("candidate score must be finite");
  }
}

/**
 * Rank at most one score per employee, retaining the best template score.
 * Current Migration 013 data has one template per employee, but this keeps
 * the test rule explicit if a read-only fixture contains more than one.
 */
export function rankCandidates(candidates) {
  const bestByEmployee = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.employeeCode !== "string" || !candidate.employeeCode) {
      throw new Error("candidate employee code is required");
    }
    assertFiniteScore(candidate.score);
    const previous = bestByEmployee.get(candidate.employeeCode);
    if (!previous || candidate.score > previous.score) {
      bestByEmployee.set(candidate.employeeCode, {
        employeeCode: candidate.employeeCode,
        score: candidate.score,
      });
    }
  }
  return [...bestByEmployee.values()].sort((left, right) =>
    right.score - left.score || left.employeeCode.localeCompare(right.employeeCode));
}

/** Proposed rule: choose the highest score; use no second-candidate rejection. */
export function decideTopScoreOnly(candidates, threshold = THRESHOLD) {
  const ranked = rankCandidates(candidates);
  const top = ranked[0] ?? null;
  const accepted = top !== null && top.score >= threshold;
  return {
    candidate: accepted ? top.employeeCode : null,
    topScore: top?.score ?? null,
    outcome: accepted ? "ACCEPTED" : "UNKNOWN",
    ranked,
  };
}

/** Current production rule, reproduced here only for comparison output. */
export function decideCurrentProduction(candidates) {
  const ranked = rankCandidates(candidates);
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  if (!top || top.score < THRESHOLD) {
    return {
      candidate: null,
      outcome: "RECOGNITION_FAILED",
      topScore: top?.score ?? null,
      secondScore: second?.score ?? null,
      margin: null,
      ranked,
    };
  }
  const margin = second ? top.score - second.score : null;
  if ((second && second.score >= THRESHOLD) || (margin !== null && margin <= AMBIGUITY_MARGIN)) {
    return {
      candidate: null,
      outcome: "AMBIGUOUS_MATCH",
      topScore: top.score,
      secondScore: second?.score ?? null,
      margin,
      ranked,
    };
  }
  return {
    candidate: top.employeeCode,
    outcome: "ACCEPTED",
    topScore: top.score,
    secondScore: second?.score ?? null,
    margin,
    ranked,
  };
}

function parseSupabaseQueryOutput(raw) {
  const match = raw.match(/\{\s*"boundary"\s*:/);
  const start = match?.index ?? -1;
  if (start < 0) throw new Error("Supabase CLI query did not return a result payload");
  const payload = JSON.parse(raw.slice(start));
  if (!Array.isArray(payload.rows)) throw new Error("Supabase CLI query returned no rows array");
  return payload.rows;
}

function readProductionScores() {
  const executable = process.platform === "win32" ? process.execPath : "supabase";
  const cliPrefix = process.platform === "win32"
    ? [join(dirname(process.execPath), "node_modules", "supabase", "dist", "supabase.js")]
    : [];
  const sql = `
    with templates as (
      select bt.id, e.employee_code, bt.embedding
        from public.biometric_templates bt
        join public.employees e on e.id = bt.employee_id
       where e.status = 'ACTIVE'
         and bt.embedding_dimension = ${EMBEDDING_DIMENSION}
         and bt.model_name = '${MODEL_NAME}'
         and bt.model_version = '${MODEL_VERSION}'
    ), scores as (
      select query_template.employee_code as query_employee,
             candidate_template.employee_code as candidate_employee,
             1 - (candidate_template.embedding <=> query_template.embedding) as score
        from templates query_template
        cross join templates candidate_template
    )
    select query_employee, candidate_employee, score
      from scores
     order by query_employee, candidate_employee;
  `;
  const oneLineSql = sql.replace(/\s+/g, " ").trim();
  const raw = execFileSync(
    executable,
    [...cliPrefix, "db", "query", "--linked", "--project-ref", PROJECT_REF, oneLineSql],
    { encoding: "utf8", windowsHide: true },
  );
  return parseSupabaseQueryOutput(raw).map((row) => ({
    queryEmployee: String(row.query_employee),
    employeeCode: String(row.candidate_employee),
    score: Number(row.score),
  }));
}

function formatScore(score) {
  return score === null || score === undefined ? "—" : Number(score).toFixed(10);
}

function printRealResults(rows) {
  const byQuery = new Map();
  for (const row of rows) {
    assertFiniteScore(row.score);
    if (!byQuery.has(row.queryEmployee)) byQuery.set(row.queryEmployee, []);
    byQuery.get(row.queryEmployee).push({ employeeCode: row.employeeCode, score: row.score });
  }
  const employeeCodes = [...new Set(rows.map((row) => row.employeeCode))].sort();
  console.log("\nREAL CURRENT STORED-TEMPLATE RESULTS");
  console.log(`Model: ${MODEL_NAME}`);
  console.log(`Model version: ${MODEL_VERSION}`);
  console.log(`Embedding dimension: ${EMBEDDING_DIMENSION}`);
  console.log(`Threshold: ${THRESHOLD.toFixed(2)}`);
  console.log(`Production ambiguity margin: ${AMBIGUITY_MARGIN.toFixed(2)}`);
  console.log("No embeddings are printed; scores are calculated by the read-only SQL query.");
  console.log(`| Query | ${employeeCodes.join(" | ")} | Highest Candidate | Highest Score | Test Rule | Current Production Rule |`);
  console.log(`|---|${employeeCodes.map(() => "---|").join("")}---|---:|---|---|`);

  for (const queryEmployee of [...byQuery.keys()].sort()) {
    const candidates = byQuery.get(queryEmployee);
    const testResult = decideTopScoreOnly(candidates);
    const productionResult = decideCurrentProduction(candidates);
    const scoreByEmployee = new Map(candidates.map((candidate) => [candidate.employeeCode, candidate.score]));
    console.log(
      `| ${queryEmployee} | ${employeeCodes.map((code) => formatScore(scoreByEmployee.get(code))).join(" | ")} ` +
      `| ${testResult.candidate ?? "UNKNOWN"} | ${formatScore(testResult.topScore)} ` +
      `| ${testResult.outcome} | ${productionResult.outcome} |`,
    );
    console.log(
      `  ${queryEmployee} candidate scores: ` +
      testResult.ranked.map((candidate) => `${candidate.employeeCode}=${formatScore(candidate.score)}`).join(", "),
    );
  }
  return byQuery;
}

function runSyntheticTests() {
  const cases = [
    { name: "A", candidates: [{ employeeCode: "A", score: 1.00 }, { employeeCode: "B", score: 0.73 }], expected: "A" },
    { name: "B", candidates: [{ employeeCode: "A", score: 0.65 }, { employeeCode: "B", score: 0.64 }], expected: "A" },
    { name: "C", candidates: [{ employeeCode: "A", score: 0.59 }, { employeeCode: "B", score: 0.40 }], expected: null },
    { name: "D", candidates: [{ employeeCode: "A", score: 0.60 }, { employeeCode: "B", score: 0.59 }], expected: "A" },
    { name: "E", candidates: [{ employeeCode: "A", score: 0.60 }, { employeeCode: "B", score: 0.60 }], expected: "A" },
  ];
  console.log("\nSYNTHETIC TEST RESULTS");
  for (const test of cases) {
    const result = decideTopScoreOnly(test.candidates);
    const passed = result.candidate === test.expected &&
      (test.expected === null ? result.outcome === "UNKNOWN" : result.outcome === "ACCEPTED");
    if (!passed) throw new Error(`synthetic case ${test.name} failed`);
    const production = decideCurrentProduction(test.candidates);
    console.log(JSON.stringify({
      case: test.name,
      top: test.candidates[0].score,
      second: test.candidates[1].score,
      expectedTestResult: test.expected ?? "UNKNOWN",
      testResult: result.candidate ?? "UNKNOWN",
      testOutcome: result.outcome,
      currentProductionOutcome: production.outcome,
      passed,
    }));
  }
}

console.log("TEST_ONLY=true");
console.log("Production files, migrations, RPCs, and attendance data are not modified by this script.");
const realRows = readProductionScores();
const realResults = printRealResults(realRows);
runSyntheticTests();

if (realResults.size === 0) throw new Error("No active compatible production templates were found");
console.log("\nTEST-ONLY RULE VERIFIED=true");
