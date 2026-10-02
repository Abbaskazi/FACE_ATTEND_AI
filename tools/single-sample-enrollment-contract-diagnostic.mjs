// Laptop-only contract test. It uses synthetic normalized 512-D vectors and
// never prints vectors, images, credentials, or production data.

const DIMENSION = 512;
const NORM_TOLERANCE = 0.01;
const MODEL_NAME = "glintr100.onnx";
const MODEL_VERSION = "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function vector(firstValue) {
  const values = Array(DIMENSION).fill(0);
  values[0] = firstValue;
  values[1] = Math.sqrt(1 - firstValue * firstValue);
  return values;
}

function norm(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function validateRequest({ embedding, modelName, modelVersion }) {
  if (!Array.isArray(embedding) || embedding.length !== DIMENSION) return "INVALID_DIMENSION";
  if (embedding.some((value) => !Number.isFinite(value))) return "INVALID_VALUE";
  if (Math.abs(norm(embedding) - 1) > NORM_TOLERANCE) return "INVALID_NORMALIZATION";
  if (modelName !== MODEL_NAME || modelVersion !== MODEL_VERSION) return "MODEL_CONTRACT_MISMATCH";
  return null;
}

function completeSingleSample(store, employeeCode, request) {
  const error = validateRequest(request);
  if (error) return { ok: false, error };
  store.set(employeeCode, [...request.embedding]);
  return { ok: true, templateCount: 1 };
}

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

const store = new Map([
  ["EMP001", vector(1)],
  ["EMP002", vector(0)],
]);
const originalEmp001 = [...store.get("EMP001")];
const originalEmp002 = [...store.get("EMP002")];
const valid = { embedding: vector(0.8), modelName: MODEL_NAME, modelVersion: MODEL_VERSION };

const invalidDimension = completeSingleSample(store, "EMP001", { ...valid, embedding: [1] });
assert(!invalidDimension.ok && invalidDimension.error === "INVALID_DIMENSION", "dimension validation failed");
assert(cosine(store.get("EMP001"), originalEmp001) === 1, "failed request changed existing template");

const invalidModel = completeSingleSample(store, "EMP001", { ...valid, modelVersion: "wrong-version" });
assert(!invalidModel.ok && invalidModel.error === "MODEL_CONTRACT_MISMATCH", "model validation failed");
assert(cosine(store.get("EMP001"), originalEmp001) === 1, "model failure changed existing template");

const nonNormalized = completeSingleSample(store, "EMP001", { ...valid, embedding: vector(0.8).map((value) => value * 2) });
assert(!nonNormalized.ok && nonNormalized.error === "INVALID_NORMALIZATION", "normalization validation failed");
assert(cosine(store.get("EMP001"), originalEmp001) === 1, "normalization failure changed existing template");

const firstEnrollment = completeSingleSample(store, "EMP003", valid);
assert(firstEnrollment.ok && firstEnrollment.templateCount === 1, "single-sample enrollment failed");
assert(store.has("EMP003"), "new employee template was not stored");

const replacement = completeSingleSample(store, "EMP001", { ...valid, embedding: vector(0.7) });
assert(replacement.ok && replacement.templateCount === 1, "re-enrollment failed");
assert(cosine(store.get("EMP001"), vector(0.7)) > 0.999999, "selected employee was not replaced");
assert(cosine(store.get("EMP002"), originalEmp002) === 1, "another employee template changed");

const attendanceCandidates = [...store.entries()]
  .map(([employeeCode, template]) => ({ employeeCode, score: cosine(vector(0.7), template) }))
  .sort((left, right) => right.score - left.score);
assert(attendanceCandidates[0].employeeCode === "EMP001", "attendance candidate mapping failed");
assert(store.size === 3, "single-template-per-employee invariant failed");

console.log(JSON.stringify({
  passed: true,
  cases: [
    "invalid dimension rejected",
    "model mismatch rejected",
    "normalization failure rejected",
    "one valid sample creates one template",
    "re-enrollment replaces only selected employee",
    "attendance reads one template per employee",
  ],
  threshold: 0.60,
  ambiguityMargin: 0.08,
}));
