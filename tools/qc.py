"""Standard quality-control dimensions shared by the tools (see docs/quality-control-checklist.md)."""

from __future__ import annotations

from typing import Dict, List, NamedTuple, Optional


class QCDimension(NamedTuple):
    check_id: str
    dimension: str
    min_pass_score: int
    csv_column: str
    per_clip: bool  # False = judged once for the whole production


STANDARD_QC: List[QCDimension] = [
    QCDimension("QC01", "Face consistency with references", 4, "qc_face", True),
    QCDimension("QC02", "Body and wardrobe consistency", 4, "qc_body_wardrobe", True),
    QCDimension("QC03", "Natural motion", 3, "qc_motion", True),
    QCDimension("QC04", "Hand and finger accuracy", 3, "qc_hands", True),
    QCDimension("QC05", "Product integrity (shape, colour, label)", 4, "qc_product", True),
    QCDimension("QC06", "Camera realism (smartphone look)", 3, "qc_camera", True),
    QCDimension("QC07", "Speech accuracy vs script", 3, "qc_speech", True),
    QCDimension("QC08", "Lip-sync accuracy", 3, "qc_lipsync", True),
    QCDimension("QC09", "Visual artifacts (warping, flicker, extra limbs)", 4, "qc_artifacts", True),
    QCDimension("QC10", "Copyright and commercial-use clearance", 5, "qc_rights", False),
]
BY_ID: Dict[str, QCDimension] = {q.check_id: q for q in STANDARD_QC}

MODE_LABELS = {
    "ingredients_to_video": "Ingredients to Video",
    "frames_to_video": "Frames to Video",
    "text_to_video": "Text to Video",
    "video_to_video": "Video to Video (edit / extend)",
}


def default_quality_checks(clip_ids: Optional[List[str]] = None, is_sample: bool = False) -> List[dict]:
    """QC entries for a new production. Per-clip checks get clip_id=None until clips exist."""
    out = []
    for q in STANDARD_QC:
        note = ""
        if q.check_id == "QC10" and is_sample:
            note = "Sample brief: internal test only, can never pass for commercial delivery."
        out.append({"check_id": q.check_id, "dimension": q.dimension, "clip_id": None, "min_pass_score": q.min_pass_score, "score": None, "notes": note})
    return out
