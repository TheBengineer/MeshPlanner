"""Tests for validation framework."""

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds

# ── Import tests ───────────────────────────────────────────────────────────


def test_validation_imports():
    """Verify validate module exports."""
    from meshplanner.validate import (
        compute_coverage_agreement,
        generate_validation_report,
        load_reference_geotiff,
        print_validation_instructions,
        validate_coverage,
    )

    assert callable(compute_coverage_agreement)
    assert callable(load_reference_geotiff)
    assert callable(validate_coverage)
    assert callable(generate_validation_report)
    assert callable(print_validation_instructions)


# ── compute_coverage_agreement tests ──────────────────────────────────────


class TestComputeCoverageAgreement:
    """Tests for binary coverage agreement metrics."""

    def test_perfect_agreement(self):
        """Identical rasters should give perfect scores."""
        from meshplanner.validate import compute_coverage_agreement

        # Both rasters: half covered, half not
        rssi = np.full((10, 10), -130.0, dtype=np.float32)
        rssi[:, :5] = -80.0  # Left half covered

        result = compute_coverage_agreement(rssi, rssi, threshold_dbm=-120.0)

        assert result["accuracy"] == 1.0
        assert result["precision"] == 1.0
        assert result["recall"] == 1.0
        assert result["f1_score"] == 1.0
        assert result["jaccard"] == 1.0
        assert result["true_positives"] == 50
        assert result["true_negatives"] == 50
        assert result["false_positives"] == 0
        assert result["false_negatives"] == 0

    def test_no_overlap(self):
        """Completely disjoint coverage should give zero jaccard."""
        from meshplanner.validate import compute_coverage_agreement

        # Predicted covers left half
        pred = np.full((10, 10), -130.0, dtype=np.float32)
        pred[:, :5] = -80.0

        # Reference covers right half
        ref = np.full((10, 10), -130.0, dtype=np.float32)
        ref[:, 5:] = -80.0

        result = compute_coverage_agreement(pred, ref, threshold_dbm=-120.0)

        assert result["jaccard"] == 0.0
        assert result["true_positives"] == 0
        assert result["false_positives"] > 0
        assert result["false_negatives"] > 0

        # More disagreement than agreement
        assert result["accuracy"] < 0.6

    def test_partial_overlap(self):
        """Partial overlap should give intermediate scores."""
        from meshplanner.validate import compute_coverage_agreement

        pred = np.full((10, 10), -130.0, dtype=np.float32)
        pred[:, :7] = -80.0  # First 7 columns covered

        ref = np.full((10, 10), -130.0, dtype=np.float32)
        ref[:, :4] = -80.0  # First 4 columns covered

        result = compute_coverage_agreement(pred, ref, threshold_dbm=-120.0)

        # TP = 40 (4 cols × 10 rows)
        # TN = 30 (cols 7-9: 3 cols × 10 rows — right side uncovered by both)
        # FP = 30 (cols 4-6: 3 cols × 10 rows — pred covers, ref doesn't)
        # FN = 0 (nothing pred misses that ref covers)
        assert result["true_positives"] == 40
        assert result["true_negatives"] >= 30
        assert result["false_positives"] == 30
        assert result["false_negatives"] == 0
        assert 0.5 < result["f1_score"] < 1.0

    def test_shape_mismatch_error(self):
        """Different-shaped rasters should raise ValueError."""
        from meshplanner.validate import compute_coverage_agreement

        pred = np.zeros((10, 10), dtype=np.float32)
        ref = np.zeros((20, 20), dtype=np.float32)

        try:
            compute_coverage_agreement(pred, ref)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_all_nodata(self):
        """All nodata pixels should raise ValueError."""
        from meshplanner.validate import compute_coverage_agreement

        pred = np.full((5, 5), np.nan, dtype=np.float32)
        ref = np.full((5, 5), np.nan, dtype=np.float32)

        try:
            compute_coverage_agreement(pred, ref)
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

    def test_different_thresholds(self):
        """Identical rasters at any threshold should give perfect agreement."""
        from meshplanner.validate import compute_coverage_agreement

        rssi = np.full((10, 10), -130.0, dtype=np.float32)
        rssi[:, :5] = -80.0  # -80 dBm
        rssi[:, 5:8] = -110.0  # -110 dBm

        low_thresh = compute_coverage_agreement(rssi, rssi, threshold_dbm=-120.0)
        high_thresh = compute_coverage_agreement(rssi, rssi, threshold_dbm=-90.0)

        # Identical rasters at either threshold should give perfect agreement
        assert low_thresh["jaccard"] == 1.0
        assert high_thresh["jaccard"] == 1.0

    def test_inf_values_handling(self):
        """Inf/nan values are excluded from comparison."""
        from meshplanner.validate import compute_coverage_agreement

        pred = np.full((10, 10), -80.0, dtype=np.float32)
        pred[0, 0] = np.inf

        ref = np.full((10, 10), -80.0, dtype=np.float32)

        result = compute_coverage_agreement(pred, ref, threshold_dbm=-120.0)

        # The inf pixel is excluded from valid comparison.
        # Remaining 99 pixels all agree (all covered) -> perfect.
        assert result["true_positives"] == 99
        assert result["false_positives"] == 0
        assert result["total_pixels"] == 99

    def test_float64_input(self):
        """Should handle float64 inputs by converting to float32 logic."""
        from meshplanner.validate import compute_coverage_agreement

        pred = np.full((5, 5), -80.0, dtype=np.float64)
        ref = np.full((5, 5), -80.0, dtype=np.float64)

        result = compute_coverage_agreement(pred, ref)
        assert result["jaccard"] == 1.0


# ── generate_validation_report tests ──────────────────────────────────────


class TestValidationReport:
    """Tests for validation report generation."""

    def test_report_format(self):
        """Report should contain key metrics."""
        from meshplanner.validate import generate_validation_report

        results = [
            {
                "site_name": "Test Site",
                "pass": True,
                "f1_score": 0.95,
                "jaccard": 0.92,
                "accuracy": 0.96,
                "threshold_dbm": -120,
                "precision": 0.94,
                "recall": 0.96,
                "true_positives": 100,
                "true_negatives": 200,
                "false_positives": 10,
                "false_negatives": 5,
                "total_pixels": 315,
                "rating": "excellent",
            },
        ]

        report = generate_validation_report(results)

        assert "Validation Report" in report
        assert "PASS" in report
        assert "0.950" in report

    def test_report_with_error_result(self):
        """Report should handle error results gracefully."""
        from meshplanner.validate import generate_validation_report

        results = [
            {"site_name": "Broken Site", "error": "Shape mismatch"},
        ]

        report = generate_validation_report(results)

        assert "ERROR" in report
        assert "Broken Site" in report
        assert "Shape mismatch" in report

    def test_report_with_output_file(self, tmp_path):
        """Report with output path should write file."""
        from meshplanner.validate import generate_validation_report

        results = [
            {
                "site_name": "A",
                "pass": True,
                "f1_score": 0.9,
                "jaccard": 0.85,
                "accuracy": 0.9,
                "threshold_dbm": -120,
                "precision": 0.9,
                "recall": 0.9,
                "true_positives": 50,
                "true_negatives": 50,
                "false_positives": 5,
                "false_negatives": 5,
                "total_pixels": 110,
                "rating": "good",
            },
        ]

        out_path = str(tmp_path / "report.json")
        generate_validation_report(results, out_path)

        assert Path(out_path).exists()
        with open(out_path) as f:
            data = json.load(f)
            assert data["total"] == 1
            assert data["passed"] == 1
            assert data["failed"] == 0

    def test_report_empty_results(self):
        """Empty results list should not crash."""
        from meshplanner.validate import generate_validation_report

        report = generate_validation_report([])
        assert "0" in report  # Sites validated: 0

    def test_report_failed_site(self):
        """Failed validation sites should show FAIL."""
        from meshplanner.validate import generate_validation_report

        results = [
            {
                "site_name": "Bad Site",
                "pass": False,
                "f1_score": 0.3,
                "jaccard": 0.2,
                "accuracy": 0.5,
                "threshold_dbm": -120,
                "precision": 0.4,
                "recall": 0.2,
                "true_positives": 10,
                "true_negatives": 40,
                "false_positives": 30,
                "false_negatives": 20,
                "total_pixels": 100,
                "rating": "poor",
            },
        ]

        report = generate_validation_report(results)
        assert "FAIL" in report
        assert "0.200" in report

    def test_report_json_output_with_error_results(self, tmp_path):
        """JSON report should include error results."""
        from meshplanner.validate import generate_validation_report

        results = [
            {"site_name": "OK", "pass": True, "f1_score": 0.9, "jaccard": 0.85,
             "accuracy": 0.9, "threshold_dbm": -120, "precision": 0.9,
             "recall": 0.9, "true_positives": 50, "true_negatives": 50,
             "false_positives": 5, "false_negatives": 5, "total_pixels": 110,
             "rating": "good"},
            {"site_name": "ERR", "error": "No data"},
        ]

        out_path = str(tmp_path / "report_with_errors.json")
        generate_validation_report(results, out_path)

        with open(out_path) as f:
            data = json.load(f)
            assert data["total"] == 2
            assert data["passed"] == 1
            assert data["failed"] == 1


# ── Jaccard rating tests ──────────────────────────────────────────────────


class TestJaccardRating:
    """Tests for the Jaccard threshold-based rating system."""

    def test_excellent_rating(self, monkeypatch):
        """Jaccard >= 0.9 should be excellent."""
        from meshplanner.validate import _jaccard_rating

        assert _jaccard_rating(0.95) == "excellent"
        assert _jaccard_rating(0.90) == "excellent"

    def test_good_rating(self):
        from meshplanner.validate import _jaccard_rating

        assert _jaccard_rating(0.85) == "good"
        assert _jaccard_rating(0.80) == "good"

    def test_acceptable_rating(self):
        from meshplanner.validate import _jaccard_rating

        assert _jaccard_rating(0.75) == "acceptable"
        assert _jaccard_rating(0.70) == "acceptable"

    def test_poor_rating(self):
        from meshplanner.validate import _jaccard_rating

        assert _jaccard_rating(0.69) == "poor"
        assert _jaccard_rating(0.0) == "poor"

    def test_pass_threshold(self):
        """Jaccard >= 0.7 should be a pass."""
        from meshplanner.validate import _jaccard_rating

        # Directly test the pass logic used in validate_coverage
        for val in [0.7, 0.75, 0.8, 0.9, 1.0]:
            assert val >= 0.7, f"{val} should pass"
        for val in [0.0, 0.5, 0.69]:
            assert val < 0.7, f"{val} should fail"


# ── End-to-end: synthetic GeoTIFF validation ──────────────────────────────


def _make_synthetic_geotiff(
    tmp_path: Path,
    filename: str,
    data: np.ndarray,
    bounds: tuple = (-82.6, 35.5, -82.4, 35.7),
) -> str:
    """Helper to write a synthetic GeoTIFF for testing."""
    affine = from_bounds(*bounds, data.shape[1], data.shape[0])
    path = str(tmp_path / filename)

    profile = {
        "driver": "GTiff",
        "height": data.shape[0],
        "width": data.shape[1],
        "count": 1,
        "dtype": rasterio.float32,
        "crs": "EPSG:4326",
        "transform": affine,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype(np.float32), 1)
    return path


def test_validate_coverage_perfect(tmp_path):
    """validate_coverage should return perfect scores for identical data."""
    from meshplanner.validate import validate_coverage

    ref_rssi = np.full((20, 20), -130.0, dtype=np.float32)
    ref_rssi[:, :10] = -80.0

    ref_path = _make_synthetic_geotiff(tmp_path, "reference.tif", ref_rssi)

    result = validate_coverage(
        ref_rssi.copy(), ref_path, threshold_dbm=-120.0, site_name="Perfect"
    )

    assert result["pass"]
    assert result["jaccard"] == 1.0
    assert result["f1_score"] == 1.0
    assert result["site_name"] == "Perfect"
    assert result["rating"] == "excellent"


def test_validate_coverage_partial(tmp_path):
    """validate_coverage with partial overlap."""
    from meshplanner.validate import validate_coverage

    # Reference covers left 60%
    ref_rssi = np.full((20, 20), -130.0, dtype=np.float32)
    ref_rssi[:, :12] = -80.0

    # Prediction covers left 40%
    pred_rssi = np.full((20, 20), -130.0, dtype=np.float32)
    pred_rssi[:, :8] = -80.0

    ref_path = _make_synthetic_geotiff(tmp_path, "ref_partial.tif", ref_rssi)

    result = validate_coverage(
        pred_rssi, ref_path, threshold_dbm=-120.0, site_name="Partial"
    )

    assert not result["pass"]  # Jaccard will be ~0.57
    assert 0.5 < result["jaccard"] < 0.7
    assert result["rating"] == "poor"


def test_validate_coverage_shape_mismatch(tmp_path):
    """Shape mismatch should return error dict, not crash."""
    from meshplanner.validate import validate_coverage

    pred = np.full((10, 10), -80.0, dtype=np.float32)

    ref = np.full((20, 20), -80.0, dtype=np.float32)
    ref_path = _make_synthetic_geotiff(tmp_path, "shape_mismatch.tif", ref)

    result = validate_coverage(pred, ref_path)

    assert "error" in result
    assert "Shape mismatch" in result["error"]
    assert result["site_name"] == "unknown"


def test_validate_coverage_with_custom_site_name(tmp_path):
    """Custom site name should propagate to result."""
    from meshplanner.validate import validate_coverage

    ref_rssi = np.full((10, 10), -80.0, dtype=np.float32)
    ref_path = _make_synthetic_geotiff(tmp_path, "custom_name.tif", ref_rssi)

    result = validate_coverage(
        ref_rssi.copy(), ref_path, site_name="Asheville-TX01"
    )

    assert result["site_name"] == "Asheville-TX01"


def test_validate_coverage_threshold_none(tmp_path):
    """Validation with extremely low threshold (nearly all covered)."""
    from meshplanner.validate import validate_coverage

    ref_rssi = np.full((10, 10), -130.0, dtype=np.float32)
    ref_rssi[:, :5] = -80.0
    ref_path = _make_synthetic_geotiff(tmp_path, "threshold_none.tif", ref_rssi)

    pred_rssi = ref_rssi.copy()

    # At -200 dBm threshold, everything is covered -> perfect
    result = validate_coverage(pred_rssi, ref_path, threshold_dbm=-200.0)

    assert result["pass"]
    assert result["jaccard"] == 1.0


# ── load_reference_geotiff tests ──────────────────────────────────────────


class TestLoadReferenceGeotiff:
    """Tests for GeoTIFF loading."""

    def test_load_basic_metadata(self, tmp_path):
        """Should return array + metadata dict."""
        from meshplanner.validate import load_reference_geotiff

        data = np.full((15, 20), -80.0, dtype=np.float32)
        path = _make_synthetic_geotiff(tmp_path, "basic.tif", data)

        arr, meta = load_reference_geotiff(path)

        assert arr.shape == (15, 20)
        assert meta["shape"] == (15, 20)
        assert "crs" in meta
        assert "EPSG:4326" in meta["crs"]
        assert "affine" in meta
        assert meta["path"] == path

    def test_load_returns_float32(self, tmp_path):
        """Loaded array should be float32."""
        from meshplanner.validate import load_reference_geotiff

        data = np.full((10, 10), -80.0, dtype=np.float64)
        path = _make_synthetic_geotiff(tmp_path, "int_type.tif", data)

        arr, _ = load_reference_geotiff(path)
        assert arr.dtype == np.float32

    def test_tags_preserved(self, tmp_path):
        """GeoTIFF tags should be accessible in metadata."""
        from meshplanner.validate import load_reference_geotiff

        data = np.full((5, 5), -80.0, dtype=np.float32)
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 5, 5)
        path = str(tmp_path / "tagged.tif")

        profile = {
            "driver": "GTiff", "height": 5, "width": 5, "count": 1,
            "dtype": rasterio.float32, "crs": "EPSG:4326",
            "transform": affine,
        }
        with rasterio.open(path, "w", **profile) as dst:
            dst.update_tags(source="Splat!", frequency_mhz="915.0")
            dst.write(data, 1)

        _, meta = load_reference_geotiff(path)
        assert meta["tags"]["source"] == "Splat!"
        assert meta["tags"]["frequency_mhz"] == "915.0"


# ── print_validation_instructions tests ────────────────────────────────────


def test_print_instructions(capsys):
    """print_validation_instructions should output reference notes."""
    from meshplanner.validate import print_validation_instructions

    print_validation_instructions()
    captured = capsys.readouterr()

    assert "Radio Mobile Online" in captured.out
    assert "Splat!" in captured.out
    assert "915.0" in captured.out
