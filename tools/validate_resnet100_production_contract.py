"""Laptop-only validation of the ResNet100 production recognition contract.

This test uses the Phase 2 images and local ONNX Runtime only. It never calls
Supabase and never writes biometric templates or production data.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from phase2.run_model_comparison import (
    DETECTOR_PATH,
    IMAGE_PATHS,
    align_arcface,
    cosine,
    filter_test_subject_faces,
    inspect_images,
    normalize,
    preprocess,
    sha256,
)
import cv2


MODEL_PATH = ROOT / "android" / "app" / "src" / "main" / "assets" / "glintr100.onnx"
MODEL_NAME = "glintr100.onnx"
MODEL_VERSION = "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf"
OLD_MODEL_NAME = "w600k_mbf.onnx"
OLD_MODEL_VERSION = "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f"
THRESHOLD = 0.60
AMBIGUITY_MARGIN = 0.08


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def evaluate(query: np.ndarray, templates: list[dict]) -> dict:
    """Mirror the production model filter and employee-level decision shape."""
    assert_true(query.shape == (512,), "query must be 512-D")
    assert_true(abs(float(np.linalg.norm(query)) - 1.0) <= 0.001, "query must be L2 normalized")

    compatible = [
        template
        for template in templates
        if template["model_name"] == MODEL_NAME
        and template["model_version"] == MODEL_VERSION
        and template["embedding"].shape == (512,)
        and abs(float(np.linalg.norm(template["embedding"])) - 1.0) <= 0.001
    ]
    best_by_employee: dict[str, float] = {}
    for template in compatible:
        score = cosine(query, template["embedding"])
        employee = template["employee"]
        if employee not in best_by_employee or score > best_by_employee[employee]:
            best_by_employee[employee] = score

    ranked = sorted(best_by_employee.items(), key=lambda item: (-item[1], item[0]))
    top = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None
    margin = top[1] - second[1] if top and second else None
    if top is None:
        decision = "NO_CANDIDATE"
    elif top[1] < THRESHOLD:
        decision = "BELOW_THRESHOLD"
    elif (second and second[1] >= THRESHOLD) or (margin is not None and margin <= AMBIGUITY_MARGIN):
        decision = "AMBIGUOUS_MATCH"
    else:
        decision = "ACCEPTED"
    return {
        "candidate_count": len(ranked),
        "top_employee": top[0] if top else None,
        "top_score": float(top[1]) if top else None,
        "second_score": float(second[1]) if second else None,
        "margin": float(margin) if margin is not None else None,
        "decision": decision,
    }


def axis(index: int, value: float = 1.0) -> np.ndarray:
    vector = np.zeros(512, dtype=np.float64)
    vector[index] = value
    return vector


def main() -> None:
    assert_true(MODEL_PATH.is_file(), f"missing production model: {MODEL_PATH}")
    actual_hash = sha256(MODEL_PATH)
    assert_true(actual_hash == MODEL_VERSION, "production model SHA-256 mismatch")

    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    assert_true(len(session.get_inputs()) == 1, "model must have one input")
    assert_true(len(session.get_outputs()) == 1, "model must have one output")
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    assert_true(input_meta.type == "tensor(float)", "input must be float32")
    assert_true(list(input_meta.shape)[1:] == [3, 112, 112], "input must be NCHW 3x112x112")
    assert_true(output_meta.type == "tensor(float)", "output must be float32")
    assert_true(list(output_meta.shape) == [1, 512], "output must be [1, 512]")

    # This directly checks RGB ordering and the exact Phase 1 normalization.
    sample_bgr = np.zeros((112, 112, 3), dtype=np.uint8)
    sample_bgr[0, 0] = [255, 127, 0]  # RGB becomes [0, 127, 255].
    sample = preprocess(sample_bgr)
    assert_true(sample.dtype == np.float32 and sample.shape == (1, 3, 112, 112), "preprocess shape/type")
    assert_true(np.isclose(sample[0, 0, 0, 0], -1.0), "RGB red channel order")
    assert_true(np.isclose(sample[0, 1, 0, 0], (127.0 - 127.5) / 127.5), "green normalization")
    assert_true(np.isclose(sample[0, 2, 0, 0], 1.0), "blue channel order")

    image_reports, images = inspect_images()
    embeddings: dict[str, np.ndarray] = {}
    for label, image in images.items():
        detector = cv2.FaceDetectorYN.create(
            str(DETECTOR_PATH), "", (image.shape[1], image.shape[0]), 0.6, 0.3, 5000
        )
        _, faces = detector.detect(image)
        filtered, _ = filter_test_subject_faces(faces)
        assert_true(len(filtered) == 1, f"{label}: expected one filtered face")
        landmarks = filtered[0][4:14].reshape(5, 2).astype(np.float64)
        tensor = preprocess(align_arcface(image, landmarks))
        raw = np.asarray(session.run([output_meta.name], {input_meta.name: tensor})[0])
        assert_true(raw.shape == (1, 512) and np.isfinite(raw).all(), f"{label}: invalid raw output")
        embedding = normalize(raw)
        assert_true(abs(float(np.linalg.norm(embedding)) - 1.0) <= 1.0e-6, f"{label}: L2 failure")
        embeddings[label] = embedding

    templates = [
        {"employee": "Employee 1", "embedding": embeddings["Employee 1 enroll"], "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
        {"employee": "Employee 2", "embedding": embeddings["Employee 2 enroll"], "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
        # This legacy record must be ignored and must never be compared.
        {"employee": "Legacy MBF", "embedding": embeddings["Employee 1 enroll"], "model_name": OLD_MODEL_NAME, "model_version": OLD_MODEL_VERSION},
    ]
    e1 = evaluate(embeddings["Employee 1 attendance"], templates)
    e2 = evaluate(embeddings["Employee 2 attendance"], templates)
    assert_true(e1["decision"] == "ACCEPTED" and e1["top_employee"] == "Employee 1", "Employee 1 recognition failed")
    assert_true(e2["decision"] == "ACCEPTED" and e2["top_employee"] == "Employee 2", "Employee 2 recognition failed")
    assert_true(e1["candidate_count"] == e2["candidate_count"] == 2, "legacy MBF template was not filtered")

    # Employee-level aggregation must collapse duplicate samples to one candidate.
    duplicate_result = evaluate(
        embeddings["Employee 1 attendance"],
        templates[:2] + [{**templates[0], "embedding": embeddings["Employee 1 enroll"] * 1.0}],
    )
    assert_true(duplicate_result["candidate_count"] == 2, "employee aggregation failed")

    # An orthogonal local fixture exercises unknown-face rejection without a production image.
    unknown = axis(0)
    for template in templates[:2]:
        unknown -= float(np.dot(unknown, template["embedding"])) * template["embedding"]
    unknown = normalize(unknown)
    unknown_result = evaluate(unknown, templates[:2])
    assert_true(unknown_result["decision"] == "BELOW_THRESHOLD", "unknown face was not rejected")

    # Boundary tests preserve the exact threshold and ambiguity semantics.
    threshold_templates = [
        {"employee": "A", "embedding": normalize(np.array([0.60, 0.80] + [0.0] * 510)), "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
        {"employee": "B", "embedding": axis(1), "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
    ]
    assert_true(evaluate(axis(0), threshold_templates)["decision"] == "ACCEPTED", "0.60 boundary changed")
    below = threshold_templates.copy()
    below[0] = {**below[0], "embedding": normalize(np.array([0.599, math.sqrt(1 - 0.599**2)] + [0.0] * 510))}
    assert_true(evaluate(axis(0), below)["decision"] == "BELOW_THRESHOLD", "below-threshold boundary changed")

    exact_margin = [
        {"employee": "A", "embedding": axis(0, 0.90) + axis(2, math.sqrt(1 - 0.90**2)), "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
        {"employee": "B", "embedding": axis(0, 0.82) + axis(3, math.sqrt(1 - 0.82**2)), "model_name": MODEL_NAME, "model_version": MODEL_VERSION},
    ]
    exact_margin_result = evaluate(axis(0), exact_margin)
    assert_true(abs(exact_margin_result["margin"] - AMBIGUITY_MARGIN) < 1.0e-12, "margin fixture drifted")
    assert_true(exact_margin_result["decision"] == "AMBIGUOUS_MATCH", "0.08 ambiguity boundary changed")

    mismatch_result = evaluate(
        embeddings["Employee 1 attendance"],
        [{"employee": "Legacy MBF", "embedding": embeddings["Employee 1 enroll"], "model_name": OLD_MODEL_NAME, "model_version": OLD_MODEL_VERSION}],
    )
    assert_true(mismatch_result["decision"] == "NO_CANDIDATE", "model mismatch was compared")

    e1_impostor = cosine(embeddings["Employee 1 attendance"], embeddings["Employee 2 enroll"])
    e2_impostor = cosine(embeddings["Employee 2 attendance"], embeddings["Employee 1 enroll"])
    print(json.dumps({
        "passed": True,
        "model": {
            "name": MODEL_NAME,
            "sha256": actual_hash,
            "bytes": MODEL_PATH.stat().st_size,
            "input_name": input_meta.name,
            "input_shape": input_meta.shape,
            "input_type": input_meta.type,
            "output_name": output_meta.name,
            "output_shape": output_meta.shape,
            "output_type": output_meta.type,
            "runtime": f"onnxruntime {ort.__version__} / CPUExecutionProvider",
            "available_providers": ort.get_available_providers(),
            "xnnpack_provider_available_on_laptop": "XNNPACKExecutionProvider" in ort.get_available_providers(),
        },
        "image_face_counts": {label: report["filtered_face_count"] for label, report in image_reports.items()},
        "results": {
            "employee1": {**e1, "impostor_score": e1_impostor},
            "employee2": {**e2, "impostor_score": e2_impostor},
        },
        "checks": [
            "exact SHA-256",
            "float32 NCHW [1,3,112,112] input",
            "RGB ordering and (pixel - 127.5) / 127.5 preprocessing",
            "float32 [1,512] output",
            "L2 normalization",
            "single-photo enrollment and attendance embedding generation",
            "genuine and impostor matching",
            "unknown-face rejection",
            "0.60 threshold boundaries",
            "0.08 ambiguity boundary",
            "employee-level candidate aggregation",
            "MBF model/version mismatch exclusion",
        ],
    }, indent=2))


if __name__ == "__main__":
    main()
