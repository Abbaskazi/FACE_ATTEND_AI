"""Laptop-only Phase 2 face-model comparison.

This harness uses only the four images in phase2/ and local ONNX assets. It
does not contact Supabase and never prints embeddings.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort


ROOT = Path(__file__).resolve().parent
IMAGE_PATHS = {
    "Employee 1 enroll": ROOT / "employee1" / "enroll.jpeg",
    "Employee 1 attendance": ROOT / "employee1" / "attendance.jpeg",
    "Employee 2 enroll": ROOT / "employee2" / "enroll.jpeg",
    "Employee 2 attendance": ROOT / "employee2" / "attendance.jpeg",
}
MODEL_PATHS = {
    "w600k_mbf": ROOT.parent / "android" / "app" / "src" / "main" / "assets" / "w600k_mbf.onnx",
    "ResNet50": ROOT / ".models" / "w600k_r50.onnx",
    "ResNet100": ROOT / ".models" / "glintr100.onnx",
}
DETECTOR_PATH = ROOT / ".models" / "face_detection_yunet_2023mar.onnx"

CANONICAL = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float64,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def face_area(face: np.ndarray) -> float:
    return float(face[2] * face[3])


def describe_faces(faces: list[np.ndarray], width: int, height: int) -> list[dict]:
    descriptions = []
    for index, face in enumerate(faces, 1):
        x, y, box_width, box_height = [float(value) for value in face[:4]]
        descriptions.append(
            {
                "index": index,
                "x": x,
                "y": y,
                "width": box_width,
                "height": box_height,
                "confidence": float(face[14]),
                "area": face_area(face),
                "normalized": {
                    "x": x / width,
                    "y": y / height,
                    "width": box_width / width,
                    "height": box_height / height,
                },
            }
        )
    return descriptions


def filter_test_subject_faces(
    faces: np.ndarray | None,
) -> tuple[list[np.ndarray], float | None]:
    """Keep only detections at least 5% of the largest detected face.

    This is deliberately a Phase 2 test-harness filter. It is not an Android
    or production recognition policy. If multiple similarly sized detections
    remain, the caller still fails closed instead of selecting by confidence.
    """
    original = [] if faces is None else list(faces)
    if not original:
        return [], None
    largest_area = max(face_area(face) for face in original)
    minimum_area = largest_area * 0.05
    filtered = [face for face in original if face_area(face) >= minimum_area]
    return filtered, minimum_area


def inspect_images() -> tuple[dict[str, dict], dict[str, np.ndarray]]:
    detector = cv2.FaceDetectorYN.create(
        str(DETECTOR_PATH), "", (320, 320), 0.6, 0.3, 5000
    )
    reports = {}
    images = {}
    for label, path in IMAGE_PATHS.items():
        if not path.is_file():
            raise RuntimeError(f"missing image: {path}")
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"unreadable image: {path}")
        height, width = image.shape[:2]
        detector.setInputSize((width, height))
        _, faces = detector.detect(image)
        original_faces = [] if faces is None else list(faces)
        filtered_faces, minimum_area = filter_test_subject_faces(faces)
        reports[label] = {
            "resolution": [int(width), int(height)],
            "original_face_count": len(original_faces),
            "original_detections": describe_faces(original_faces, width, height),
            "filter_minimum_area": minimum_area,
            "filtered_face_count": len(filtered_faces),
            "filtered_detections": describe_faces(filtered_faces, width, height),
            "landmarks_available": False,
            "detector": "YuNet 2023mar",
        }
        count = len(filtered_faces)
        if count != 1:
            raise RuntimeError(
                f"{label}: face ambiguity after 5% area filter; "
                f"original={len(original_faces)} filtered={count}"
            )
        face = filtered_faces[0]
        landmarks = face[4:14].reshape(5, 2).astype(np.float64)
        reports[label]["landmarks_available"] = bool(np.isfinite(landmarks).all())
        images[label] = image
    return reports, images


def align_arcface(image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    source_center = landmarks.mean(axis=0)
    destination_center = CANONICAL.mean(axis=0)
    centered_source = landmarks - source_center
    centered_destination = CANONICAL - destination_center
    denominator = float(np.sum(centered_source * centered_source))
    if denominator <= 1.0e-6:
        raise RuntimeError("degenerate facial landmarks")
    a = float(np.sum(centered_source[:, 0] * centered_destination[:, 0] +
                    centered_source[:, 1] * centered_destination[:, 1]) / denominator)
    b = float(np.sum(centered_source[:, 0] * centered_destination[:, 1] -
                    centered_source[:, 1] * centered_destination[:, 0]) / denominator)
    tx = float(destination_center[0] - a * source_center[0] + b * source_center[1])
    ty = float(destination_center[1] - b * source_center[0] - a * source_center[1])
    transform = np.array([[a, -b, tx], [b, a, ty]], dtype=np.float32)
    return cv2.warpAffine(
        image,
        transform,
        (112, 112),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )


def preprocess(aligned_bgr: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2RGB)
    values = (rgb.astype(np.float32) - 127.5) / 127.5
    return np.transpose(values, (2, 0, 1))[None, ...]


def normalize(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64).reshape(-1)
    if not np.isfinite(values).all():
        raise RuntimeError("model output contains non-finite values")
    norm = float(np.linalg.norm(values))
    if norm <= 1.0e-12:
        raise RuntimeError("model output norm is zero")
    result = values / norm
    if abs(float(np.linalg.norm(result)) - 1.0) > 1.0e-6:
        raise RuntimeError("normalized embedding failed norm check")
    return result


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right)))


def model_result(name: str, path: Path, images: dict[str, np.ndarray], image_reports: dict) -> dict:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    if input_meta.type != "tensor(float)":
        raise RuntimeError(f"{name}: unsupported input type {input_meta.type}")
    if list(input_meta.shape)[1:] != [3, 112, 112]:
        raise RuntimeError(f"{name}: unsupported input shape {input_meta.shape}")
    if list(output_meta.shape)[-1] != 512:
        raise RuntimeError(f"{name}: unsupported output shape {output_meta.shape}")

    embeddings = {}
    timings_ms = []
    for label, image in images.items():
        # YuNet returns image-left/image-right ArcFace-compatible five-point order.
        # The detector metadata is kept separate from the recognition model.
        detector = cv2.FaceDetectorYN.create(
            str(DETECTOR_PATH), "", (image.shape[1], image.shape[0]), 0.6, 0.3, 5000
        )
        _, faces = detector.detect(image)
        filtered_faces, _ = filter_test_subject_faces(faces)
        if len(filtered_faces) != 1:
            raise RuntimeError(
                f"{name}/{label}: face ambiguity after 5% area filter; "
                f"filtered={len(filtered_faces)}"
            )
        landmarks = filtered_faces[0][4:14].reshape(5, 2).astype(np.float64)
        tensor = preprocess(align_arcface(image, landmarks))
        start = time.perf_counter()
        raw = session.run([output_meta.name], {input_meta.name: tensor})[0]
        timings_ms.append((time.perf_counter() - start) * 1000.0)
        embeddings[label] = normalize(raw)

    e1_enroll = embeddings["Employee 1 enroll"]
    e1_query = embeddings["Employee 1 attendance"]
    e2_enroll = embeddings["Employee 2 enroll"]
    e2_query = embeddings["Employee 2 attendance"]
    rows = [
        {
            "query": "Employee 1",
            "genuine_score": cosine(e1_query, e1_enroll),
            "impostor_score": cosine(e1_query, e2_enroll),
        },
        {
            "query": "Employee 2",
            "genuine_score": cosine(e2_query, e2_enroll),
            "impostor_score": cosine(e2_query, e1_enroll),
        },
    ]
    for row in rows:
        row["margin"] = row["genuine_score"] - row["impostor_score"]
        row["correct_top_candidate"] = row["margin"] > 0
    self_scores = [cosine(value, value) for value in embeddings.values()]
    return {
        "model": name,
        "filename": path.name,
        "sha256": sha256(path),
        "size_bytes": path.stat().st_size,
        "input_name": input_meta.name,
        "input_shape": input_meta.shape,
        "input_type": input_meta.type,
        "output_name": output_meta.name,
        "output_shape": output_meta.shape,
        "output_type": output_meta.type,
        "preprocessing": "RGB float32 NCHW, (pixel - 127.5) / 127.5",
        "normalization": "L2 after model output",
        "runtime": f"onnxruntime {ort.__version__} / CPUExecutionProvider",
        "inference_success": True,
        "average_inference_ms": float(np.mean(timings_ms)),
        "image_reports": image_reports,
        "rows": rows,
        "self_scores": self_scores,
        "aggregate": {
            "average_genuine": float(np.mean([r["genuine_score"] for r in rows])),
            "average_impostor": float(np.mean([r["impostor_score"] for r in rows])),
            "minimum_genuine": float(min(r["genuine_score"] for r in rows)),
            "maximum_impostor": float(max(r["impostor_score"] for r in rows)),
            "average_margin": float(np.mean([r["margin"] for r in rows])),
        },
    }


def main() -> None:
    if not DETECTOR_PATH.is_file():
        raise RuntimeError(f"missing local detector: {DETECTOR_PATH}")
    image_reports, images = inspect_images()
    results = []
    failures = []
    for name, path in MODEL_PATHS.items():
        if not path.is_file() or path.stat().st_size == 0:
            failures.append({"model": name, "reason": "model file unavailable"})
            continue
        try:
            results.append(model_result(name, path, images, image_reports))
        except Exception as error:  # report one model failure while continuing others
            failures.append({"model": name, "reason": str(error)})
    if not results:
        raise RuntimeError("no model completed")
    output = {
        "image_validation": image_reports,
        "models": results,
        "failures": failures,
        "sanity": {
            "all_embeddings_finite": True,
            "all_embeddings_dimension": 512,
            "all_embeddings_l2_normalized": True,
            "cosine_self_scores": [r["self_scores"] for r in results],
        },
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
