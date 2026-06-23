"""Coverage validation framework.

Compares MeshPlanner coverage predictions against reference tools
(Radio Mobile, Splat!, or field measurements).

Methodology:
1. Generate coverage prediction with MeshPlanner
2. Load reference coverage from GeoTIFF (same area, resolution, threshold)
3. Compute agreement metrics: accuracy, precision, recall, F1, Jaccard
4. Produce validation report

The reference tools (Radio Mobile, Splat!) are NOT installed in this
environment. The framework is designed so that validation logic can be
tested with synthetic data. Real validation requires generating reference
data separately via the scripts in scripts/.
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Optional

import numpy as np
import rasterio


def compute_coverage_agreement(
    predicted_rssi: np.ndarray,
    reference_rssi: np.ndarray,
    threshold_dbm: float = -120.0,
) -> dict:
    """Compute agreement metrics between predicted and reference coverage.

    Both rasters must be the same shape and in the same CRS/projection.
    Both are thresholded at *threshold_dbm* to produce binary coverage masks.

    Args:
        predicted_rssi: RSSI raster from MeshPlanner (dBm).
        reference_rssi: RSSI raster from reference tool (dBm).
        threshold_dbm: RSSI threshold for coverage (default -120 dBm for SF10).

    Returns:
        dict with:
            accuracy: (TP + TN) / (TP + TN + FP + FN)
            precision: TP / (TP + FP)
            recall: TP / (TP + FN)
            f1_score: 2 * precision * recall / (precision + recall)
            jaccard: TP / (TP + FP + FN)
            true_positives: Predicted covered & actually covered
            true_negatives: Predicted not covered & actually not covered
            false_positives: Predicted covered but actually not covered
            false_negatives: Predicted not covered but actually covered
            threshold_dbm: The threshold used
            total_pixels: Total valid pixels compared
    """
    if predicted_rssi.shape != reference_rssi.shape:
        raise ValueError(
            f"Shape mismatch: predicted {predicted_rssi.shape} vs "
            f"reference {reference_rssi.shape}"
        )

    # Ensure both are finite
    valid = np.isfinite(predicted_rssi) & np.isfinite(reference_rssi)

    if valid.sum() == 0:
        raise ValueError("No valid (finite) pixels to compare")

    # Binary masks at threshold
    pred_covered = (predicted_rssi >= threshold_dbm) & valid
    ref_covered = (reference_rssi >= threshold_dbm) & valid

    # Confusion matrix
    tp = int(np.sum(pred_covered & ref_covered))
    tn = int(np.sum(~pred_covered & ~ref_covered & valid))
    fp = int(np.sum(pred_covered & ~ref_covered & valid))
    fn = int(np.sum(~pred_covered & ref_covered & valid))

    total = tp + tn + fp + fn
    accuracy = (tp + tn) / total if total > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (
        (2 * precision * recall / (precision + recall))
        if (precision + recall) > 0
        else 0.0
    )
    jaccard = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0.0

    return {
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1_score": round(float(f1), 4),
        "jaccard": round(float(jaccard), 4),
        "true_positives": tp,
        "true_negatives": tn,
        "false_positives": fp,
        "false_negatives": fn,
        "threshold_dbm": threshold_dbm,
        "total_pixels": total,
    }


def load_reference_geotiff(path: str) -> tuple[np.ndarray, dict]:
    """Load a reference coverage GeoTIFF.

    Args:
        path: Path to the reference coverage GeoTIFF file.

    Returns:
        tuple of (rssi_array, metadata)
        metadata includes: affine, crs, shape, tags
    """
    with rasterio.open(path) as src:
        data = src.read(1).astype(np.float32)
        meta = {
            "affine": src.transform,
            "crs": src.crs.to_string() if src.crs else None,
            "shape": src.shape,
            "tags": src.tags(),
            "path": path,
        }
    return data, meta


def validate_coverage(
    predicted_rssi: np.ndarray,
    reference_path: str,
    threshold_dbm: float = -120.0,
    site_name: str = "unknown",
) -> dict:
    """Full validation of a coverage prediction against a reference GeoTIFF.

    Args:
        predicted_rssi: RSSI raster from MeshPlanner.
        reference_path: Path to reference coverage GeoTIFF.
        threshold_dbm: RSSI coverage threshold.
        site_name: Name/ID of the site being validated.

    Returns:
        dict with agreement metrics plus metadata. If shape mismatch or
        other error occurs, returns a dict with an ``error`` key.
    """
    reference_rssi, ref_meta = load_reference_geotiff(reference_path)

    try:
        agreement = compute_coverage_agreement(
            predicted_rssi, reference_rssi, threshold_dbm
        )
    except ValueError as e:
        return {"error": str(e), "site_name": site_name}

    # Determine pass/fail based on Jaccard similarity
    jaccard = agreement["jaccard"]
    rating = _jaccard_rating(jaccard)

    result: dict = {
        "site_name": site_name,
        "threshold_dbm": threshold_dbm,
        "rating": rating,
        "pass": jaccard >= 0.7,
        **agreement,
    }

    return result


def _jaccard_rating(jaccard: float) -> str:
    """Convert a Jaccard similarity value to a human-readable rating."""
    thresholds = [
        (0.9, "excellent"),
        (0.8, "good"),
        (0.7, "acceptable"),
    ]
    for thresh, label in thresholds:
        if jaccard >= thresh:
            return label
    return "poor"


def generate_validation_report(
    results: list, output_path: Optional[str] = None
) -> str:
    """Generate a human-readable validation report.

    Args:
        results: List of validate_coverage result dicts.
        output_path: Optional path to write JSON report.

    Returns:
        Report as formatted string.
    """
    report_lines = [
        "=" * 60,
        "Coverage Validation Report",
        f"Generated: {datetime.datetime.now().isoformat()}",
        f"Sites validated: {len(results)}",
        "=" * 60,
    ]

    passed = sum(1 for r in results if "error" not in r and r.get("pass", False))
    failed = sum(1 for r in results if "error" in r or not r.get("pass", False))

    report_lines.append(f"Passed: {passed}/{len(results)}")
    report_lines.append(f"Failed: {failed}/{len(results)}")
    report_lines.append("")

    for i, result in enumerate(results):
        if "error" in result:
            report_lines.append(
                f"  [{i + 1}] {result['site_name']}: ERROR - {result['error']}"
            )
            continue

        status = "PASS" if result.get("pass") else "FAIL"
        f1 = result.get("f1_score", 0)
        jac = result.get("jaccard", 0)
        acc = result.get("accuracy", 0)
        report_lines.append(
            f"  [{i + 1}] {result['site_name']}: {status} "
            f"(F1={f1:.3f}, Jaccard={jac:.3f}, Accuracy={acc:.3f})"
        )

    if output_path:
        output_path_obj = Path(output_path)
        output_path_obj.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path_obj, "w") as f:
            json.dump(
                {
                    "timestamp": datetime.datetime.now().isoformat(),
                    "total": len(results),
                    "passed": passed,
                    "failed": failed,
                    "results": results,
                },
                f,
                indent=2,
            )

    return "\n".join(report_lines)


# ── Reference generation instructions ──────────────────────────────────────

RADIO_MOBILE_NOTES = """
To generate reference coverage data with Radio Mobile Online:

1. Go to https://www.ve2dbe.com/rmonline.html
2. Set up a link with the same parameters as your MeshPlanner run:
   - Frequency: 915.0 MHz
   - TX power: 20 dBm (or your configured value)
   - Antenna heights: 10m TX, 1.5m RX
   - Polarization: Vertical
3. Set the location to Asheville, NC area
4. Run the coverage prediction at maximum resolution
5. Export as GeoTIFF and save to tests/fixtures/reference_coverage_*.tif

To generate with Splat! (Linux):
1. Install splat from repository or build from source
2. Run: splat -t tx_site.qth -o output_name -d srtm_directory -L 5.0 -f 915.0
   where tx_site.qth contains: TX lat/lon and antenna height
3. The output is a SIGLOSS file that can be converted to GeoTIFF
4. Save to tests/fixtures/reference_coverage_*.tif
"""


def print_validation_instructions() -> None:
    """Print instructions for generating reference data."""
    print(RADIO_MOBILE_NOTES.strip())
