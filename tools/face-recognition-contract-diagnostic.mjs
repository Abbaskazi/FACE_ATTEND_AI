// Laptop-only contract harness.
// Uses synthetic low-dimensional fixtures to test decision mechanics only.
// It never prints vectors, images, credentials, or production biometric data.

const THRESHOLD = 0.60;
const AMBIGUITY_MARGIN = 0.08;
const MODEL_NAME = "glintr100.onnx";
const MODEL_VERSION = "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf";
const DIMENSION = 4; // Synthetic fixture dimension; production contract is 512.
const TOLERANCE = 0.02;

function l2(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function normalize(vector) {
  const norm = l2(vector);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) throw new Error("zero_vector");
  return vector.map((value) => value / norm);
}

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function safeScore(value) {
  return Number(value.toFixed(6));
}

function evaluate({ query, templates, modelName = MODEL_NAME, modelVersion = MODEL_VERSION }) {
  if (!Array.isArray(query) || query.length !== DIMENSION) return { decision: "INVALID_EMBEDDING" };
  const queryNorm = l2(query);
  if (Math.abs(queryNorm - 1) > TOLERANCE) return { decision: "NORMALIZATION_FAILURE" };

  const compatible = templates.filter((template) =>
    template.modelName === modelName &&
    template.modelVersion === modelVersion &&
    template.embedding.length === DIMENSION &&
    Math.abs(l2(template.embedding) - 1) <= TOLERANCE
  );
  if (compatible.length !== templates.length) return { decision: "MODEL_OR_TEMPLATE_CONTRACT_FAILURE" };

  const bestPerEmployee = new Map();
  for (const template of compatible) {
    const score = cosine(query, template.embedding);
    const current = bestPerEmployee.get(template.employeeCode);
    if (!current || score > current.score) {
      bestPerEmployee.set(template.employeeCode, { employeeCode: template.employeeCode, score });
    }
  }

  const ranked = [...bestPerEmployee.values()].sort((left, right) =>
    right.score - left.score || left.employeeCode.localeCompare(right.employeeCode)
  );
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const margin = top && second ? top.score - second.score : null;
  let decision = "NO_CANDIDATE";
  if (top && top.score < THRESHOLD) decision = "BELOW_THRESHOLD";
  else if (top && ((second && second.score >= THRESHOLD) || (margin !== null && margin <= AMBIGUITY_MARGIN))) {
    decision = "AMBIGUOUS_MATCH";
  } else if (top) decision = "ACCEPTED";

  return {
    candidateCount: ranked.length,
    topCandidate: top?.employeeCode ?? null,
    topScore: top ? safeScore(top.score) : null,
    secondCandidate: second?.employeeCode ?? null,
    secondScore: second ? safeScore(second.score) : null,
    scoreMargin: margin === null ? null : safeScore(margin),
    threshold: THRESHOLD,
    ambiguityMargin: AMBIGUITY_MARGIN,
    decision,
  };
}

function template(employeeCode, embedding, overrides = {}) {
  return {
    employeeCode,
    embedding,
    modelName: overrides.modelName ?? MODEL_NAME,
    modelVersion: overrides.modelVersion ?? MODEL_VERSION,
  };
}

const axisA = [1, 0, 0, 0];
const axisB = [0, 1, 0, 0];
const axisC = [0, 0, 1, 0];
const nearA = normalize([0.92, 0.18, 0, 0]);
const nearB = normalize([0.18, 0.92, 0, 0]);

const tests = [
  {
    name: "same-person enrollment image",
    kind: "genuine",
    query: axisA,
    templates: [template("EMP001", axisA), template("EMP-002", axisB), template("EMP-003", axisC)],
    expected: "ACCEPTED",
  },
  {
    name: "same-person different image",
    kind: "genuine",
    query: nearA,
    templates: [template("EMP001", axisA), template("EMP-002", axisB), template("EMP-003", axisC)],
    expected: "ACCEPTED",
  },
  {
    name: "different-person image must not identify source as EMP001",
    kind: "impostor",
    sourceEmployee: "EMP001",
    query: axisB,
    templates: [template("EMP001", axisA), template("EMP-002", axisB), template("EMP-003", axisC)],
    expected: "EMP-002",
  },
  {
    name: "multiple templates grouped by employee",
    kind: "genuine",
    query: nearA,
    templates: [
      template("EMP001", axisA),
      template("EMP001", nearA),
      template("EMP-002", axisB),
    ],
    expected: "ACCEPTED",
    expectedCandidateCount: 2,
  },
  {
    name: "best template represents employee",
    kind: "genuine",
    query: nearB,
    templates: [
      template("EMP001", axisA),
      template("EMP001", nearA),
      template("EMP-002", axisB),
    ],
    expected: "EMP-002",
  },
  {
    name: "non-normalized query fails closed",
    kind: "contract",
    query: [2, 0, 0, 0],
    templates: [template("EMP001", axisA)],
    expected: "NORMALIZATION_FAILURE",
  },
  {
    name: "model/version mismatch fails closed",
    kind: "contract",
    query: axisA,
    templates: [template("EMP001", axisA, { modelVersion: "wrong-version" })],
    expected: "MODEL_OR_TEMPLATE_CONTRACT_FAILURE",
  },
  {
    name: "top score below threshold",
    kind: "decision",
    query: axisC,
    templates: [template("EMP001", axisA), template("EMP-002", axisB)],
    expected: "BELOW_THRESHOLD",
  },
  {
    name: "second candidate above threshold is ambiguous",
    kind: "decision",
    query: normalize([0.80, 0.60, 0, 0]),
    templates: [template("EMP001", axisA), template("EMP-002", axisB)],
    expected: "AMBIGUOUS_MATCH",
  },
  {
    name: "small top-two margin is ambiguous",
    kind: "decision",
    query: normalize([0.72, 0.69, 0, 0]),
    templates: [template("EMP001", axisA), template("EMP-002", axisB)],
    expected: "AMBIGUOUS_MATCH",
  },
];

let failures = 0;
for (const test of tests) {
  const result = evaluate(test);
  const passed = test.expectedCandidateCount === undefined
    ? (result.decision === test.expected || result.topCandidate === test.expected)
    : result.decision === test.expected && result.candidateCount === test.expectedCandidateCount;
  if (!passed) failures++;
  console.log(JSON.stringify({
    test: test.name,
    kind: test.kind,
    topCandidate: result.topCandidate ?? null,
    topScore: result.topScore ?? null,
    secondCandidate: result.secondCandidate ?? null,
    secondScore: result.secondScore ?? null,
    scoreMargin: result.scoreMargin ?? null,
    threshold: THRESHOLD,
    ambiguityMargin: AMBIGUITY_MARGIN,
    finalDecision: result.decision,
    passed,
  }));
}

console.log(JSON.stringify({
  contract: { modelName: MODEL_NAME, modelVersion: MODEL_VERSION, dimension: 512, syntheticFixtureDimension: DIMENSION },
  tests: tests.length,
  failures,
}));

if (failures > 0) process.exitCode = 1;
