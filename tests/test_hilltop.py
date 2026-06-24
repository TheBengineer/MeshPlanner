"""Tests for hilltop detection from DEM data."""

import numpy as np
import pytest
from rasterio.transform import from_bounds

from meshplanner.sites.hilltop import (
    _bilinear_interpolate,
    _compute_pixel_size_km,
    _haversine_distance,
    _intermediate_point,
    _make_circular_footprint,
    _min_elevation_on_path,
    detect_hilltops,
)

# ── Helpers ──────────────────────────────────────────────────────────────────


def _synthetic_dem(rows=20, cols=20):
    """Synthetic DEM over Asheville bbox with two distinct hills.

    Hill A (tall, centre-left):  rows 5-9, cols 3-7  →  max 500 m
    Hill B (shorter, centre-right): rows 7-11, cols 11-15 → max 300 m
    Background: 100 m with a gentle slope southward.
    """
    dem = np.full((rows, cols), 100.0, dtype=np.float32)

    # Gentle southward slope: -1 m/row
    for r in range(rows):
        dem[r, :] -= float(r) * 1.0

    # Hill A — Gaussian-ish bump
    for r in range(5, 10):
        for c in range(3, 8):
            dr = (r - 7) / 2.5
            dc = (c - 5) / 2.5
            dem[r, c] += 400.0 * np.exp(-(dr * dr + dc * dc))

    # Hill B — smaller bump
    for r in range(7, 12):
        for c in range(11, 16):
            dr = (r - 9) / 2.0
            dc = (c - 13) / 2.0
            dem[r, c] += 200.0 * np.exp(-(dr * dr + dc * dc))

    affine = from_bounds(-82.6, 35.5, -82.4, 35.7, cols, rows)
    metadata = {
        "affine": affine,
        "crs": "EPSG:4326",
        "bounds": {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7},
    }
    return dem, metadata


def _single_peak_dem(rows=10, cols=10):
    """DEM with a single peak in the centre, flat elsewhere."""
    dem = np.zeros((rows, cols), dtype=np.float32)
    dem[5, 5] = 200.0
    affine = from_bounds(-82.6, 35.5, -82.4, 35.7, cols, rows)
    return dem, {"affine": affine, "crs": "EPSG:4326"}


# ── Haversine distance ───────────────────────────────────────────────────────


class TestHaversineDistance:
    def test_same_point(self):
        assert _haversine_distance(35.6, -82.5, 35.6, -82.5) == 0.0

    def test_one_degree_equator(self):
        d = _haversine_distance(0.0, 0.0, 0.0, 1.0)
        assert 110.0 < d < 113.0

    def test_asheville_diagonal(self):
        d = _haversine_distance(35.5, -82.6, 35.7, -82.4)
        assert 20.0 < d < 30.0


# ── Intermediate point ───────────────────────────────────────────────────────


class TestIntermediatePoint:
    def test_start(self):
        lat, lon = _intermediate_point(35.6, -82.5, 35.7, -82.4, 0.0)
        assert abs(lat - 35.6) < 1e-10
        assert abs(lon + 82.5) < 1e-10

    def test_end(self):
        lat, lon = _intermediate_point(35.6, -82.5, 35.7, -82.4, 1.0)
        assert abs(lat - 35.7) < 1e-10
        assert abs(lon + 82.4) < 1e-10

    def test_midpoint(self):
        lat, lon = _intermediate_point(35.5, -82.6, 35.7, -82.4, 0.5)
        assert abs(lat - 35.6) < 0.01
        assert abs(lon + 82.5) < 0.01


# ── Bilinear interpolation ───────────────────────────────────────────────────


class TestBilinearInterpolate:
    def test_pixel_centre(self):
        dem = np.array([[10, 20], [30, 40]], dtype=np.float32)
        assert _bilinear_interpolate(dem, 0.0, 0.0) == 10.0
        assert _bilinear_interpolate(dem, 1.0, 1.0) == 40.0

    def test_centre_of_2x2(self):
        dem = np.array([[0, 10], [10, 20]], dtype=np.float32)
        r = _bilinear_interpolate(dem, 0.5, 0.5)
        assert r is not None and abs(r - 10.0) < 1e-6

    def test_out_of_bounds_left(self):
        dem = np.array([[10, 20], [30, 40]], dtype=np.float32)
        assert _bilinear_interpolate(dem, -0.5, 0.0) is None

    def test_out_of_bounds_top(self):
        dem = np.array([[10, 20], [30, 40]], dtype=np.float32)
        assert _bilinear_interpolate(dem, 0.0, -0.5) is None

    def test_nodata(self):
        dem = np.array([[-32768, 20], [30, 40]], dtype=np.float32)
        assert _bilinear_interpolate(dem, 0.5, 0.5) is None


# ── Circular footprint ───────────────────────────────────────────────────────


class TestMakeCircularFootprint:
    def test_radius_1(self):
        fp = _make_circular_footprint(1)
        assert fp.shape == (3, 3)
        assert fp[1, 1]  # centre
        # Corners should be outside radius 1
        assert not fp[0, 0]

    def test_radius_0(self):
        fp = _make_circular_footprint(0)
        assert fp.shape == (1, 1)
        assert fp[0, 0]

    def test_radius_2(self):
        fp = _make_circular_footprint(2)
        assert fp.shape == (5, 5)
        assert fp[2, 2]  # centre
        assert not fp[0, 0]  # corner (distance √8 ≈ 2.83 > 2)


# ── Pixel size ───────────────────────────────────────────────────────────────


class TestComputePixelSizeKm:
    def test_approximate_30m(self):
        """30m DEM at Asheville latitude ~ approximate check."""
        from rasterio.transform import from_bounds

        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 667, 667)
        px_km = _compute_pixel_size_km(affine, 35.6)
        # ~0.03 km = 30 m, within 50% tolerance given lat-lon distortion
        assert 0.015 < px_km < 0.045


# ── Path minimum ─────────────────────────────────────────────────────────────


class TestMinElevationOnPath:
    def test_flat_terrain(self):
        """Path across flat terrain returns the constant elevation."""
        dem = np.full((10, 10), 100.0, dtype=np.float32)
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)
        result = _min_elevation_on_path(
            dem, affine, 35.55, -82.55, 35.65, -82.45, num_samples=20,
        )
        assert result is not None
        assert abs(result - 100.0) < 1.0

    def test_path_through_hill(self):
        """Path that crosses a hill returns the valley elevation beyond."""
        dem = np.zeros((10, 10), dtype=np.float32)
        dem[5, 5] = 200.0
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)
        # Path from near the peak to off the hill
        result = _min_elevation_on_path(
            dem, affine, 35.56, -82.50, 35.65, -82.45, num_samples=30,
        )
        assert result is not None
        assert result < 100.0  # Should find areas well below the 200 m peak


# ── detect_hilltops integration ──────────────────────────────────────────────


class TestDetectHilltops:

    # -- Basic functionality ------------------------------------------------

    def test_two_hills(self):
        """Two distinct hills produce exactly two peaks."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0, min_distance_km=1.0)
        assert len(results) == 2, f"Expected 2 peaks, got {len(results)}: {results}"

    def test_structure(self):
        """Returned dicts have the expected keys."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        assert len(results) > 0
        for r in results:
            assert set(r.keys()) == {"lat", "lon", "elevation_m", "prominence_m"}

    def test_sorted_descending(self):
        """Results are sorted by elevation descending."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        elevations = [r["elevation_m"] for r in results]
        assert elevations == sorted(elevations, reverse=True)

    def test_values_are_floats(self):
        """Lat, lon, elevation, and prominence are all Python floats."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        for r in results:
            assert isinstance(r["lat"], float)
            assert isinstance(r["lon"], float)
            assert isinstance(r["elevation_m"], float)
            assert isinstance(r["prominence_m"], float)

    def test_highest_peak_is_tall_hill(self):
        """The highest detected peak should be the 500 m hill."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        assert len(results) >= 1
        # Hill A peaks at ~500 m; allow some interpolation tolerance
        assert results[0]["elevation_m"] > 450.0

    # -- Empty / edge cases -------------------------------------------------

    def test_all_nodata(self):
        """All-nodata DEM returns an empty list."""
        dem = np.full((10, 10), -32768, dtype=np.float32)
        meta = {"affine": from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)}
        assert detect_hilltops(dem, meta) == []

    def test_all_nan(self):
        """All-NaN DEM returns an empty list."""
        dem = np.full((10, 10), np.nan, dtype=np.float32)
        meta = {"affine": from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)}
        assert detect_hilltops(dem, meta) == []

    def test_flat_dem(self):
        """A completely flat DEM (no relief) returns no peaks."""
        dem = np.full((20, 20), 500.0, dtype=np.float32)
        meta = {"affine": from_bounds(-82.6, 35.5, -82.4, 35.7, 20, 20)}
        results = detect_hilltops(dem, meta)
        assert results == []

    def test_single_peak(self):
        """A single isolated peak is detected."""
        dem, meta = _single_peak_dem(10, 10)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        assert len(results) == 1
        assert results[0]["elevation_m"] == 200.0

    # -- Prominence filtering -----------------------------------------------

    def test_prominence_filter_removes_low_peak(self):
        """A low-prominence peak is removed when min_prominence is raised."""
        dem, meta = _synthetic_dem(20, 20)
        # Low min-prominence: both hills survive
        all_peaks = detect_hilltops(dem, meta, min_prominence_m=1.0, min_distance_km=1.0)
        # High min-prominence: only the tall hill survives
        tall_only = detect_hilltops(dem, meta, min_prominence_m=250.0, min_distance_km=1.0)
        assert len(all_peaks) == 2, f"Expected 2 peaks, got {len(all_peaks)}"
        assert len(tall_only) == 1, f"Expected 1 peak, got {len(tall_only)}"
        assert tall_only[0]["elevation_m"] > 400.0

    def test_prominence_default_filter(self):
        """Default min_prominence_m=50.0 filters appropriately."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_distance_km=1.0)
        # Hill B (300 m) sits on a 100 m base → prominence ~200 m
        # Hill A (500 m) has even higher prominence
        # Both should pass the 50 m threshold
        assert len(results) >= 2, f"Expected >=2 peaks, got {len(results)}"

    # -- Distance filtering (NMS) ------------------------------------------

    def test_distance_filter_merges_close_peaks(self):
        """Close peaks within min_distance_km are merged (highest survives)."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        # Two peaks very close together
        dem[10, 10] = 500.0
        dem[10, 11] = 490.0
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 20, 20)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        # Large NMS radius merges them
        results = detect_hilltops(dem, meta, min_prominence_m=1.0, min_distance_km=100.0)
        assert len(results) == 1
        # The higher peak survives
        assert results[0]["elevation_m"] == 500.0

    def test_distance_filter_allows_far_peaks(self):
        """Peaks far apart survive the distance filter."""
        dem = np.full((30, 30), 100.0, dtype=np.float32)
        dem[5, 5] = 500.0
        dem[25, 25] = 400.0
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 30, 30)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        results = detect_hilltops(dem, meta, min_prominence_m=1.0, min_distance_km=1.0)
        assert len(results) == 2

    def test_distance_default(self):
        """Default min_distance_km=0.5 should work without error."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        assert len(results) >= 1

    # -- Nodata exclusion --------------------------------------------------

    def test_nodata_cells_never_peaks(self):
        """Nodata cells (-32768) are never returned as peaks."""
        dem, meta = _synthetic_dem(20, 20)
        dem[7, 5] = -32768.0  # Invalidate the centre of Hill A
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        for r in results:
            assert r["elevation_m"] > -30000

    # -- Geographic correctness --------------------------------------------

    def test_peak_within_dem_bounds(self):
        """All detected peaks fall within the DEM bounding box."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        bounds = meta["bounds"]
        for r in results:
            assert bounds["west"] <= r["lon"] <= bounds["east"]
            assert bounds["south"] <= r["lat"] <= bounds["north"]

    # -- Float32 input -----------------------------------------------------

    def test_float32_input(self):
        """Float32 DEM arrays work correctly."""
        dem, meta = _synthetic_dem(20, 20)
        dem = dem.astype(np.float32)
        results = detect_hilltops(dem, meta, min_prominence_m=10.0)
        assert len(results) >= 1

    # -- 0 min_prominence --------------------------------------------------

    def test_zero_prominence(self):
        """min_prominence_m=0 returns all detected peaks."""
        dem, meta = _synthetic_dem(20, 20)
        results = detect_hilltops(dem, meta, min_prominence_m=0.0)
        assert len(results) >= 2


# ── Integration with real DEM shape patterns ─────────────────────────────────


class TestDetectHilltopsIntegration:
    """Tests that exercise real-world patterns."""

    def test_ridge_line(self):
        """A ridge (line of high values) produces a single peak after NMS."""
        dem = np.full((30, 30), 100.0, dtype=np.float32)
        # A ridge along the centre row
        dem[15, 5:25] = 300.0
        # Add a slightly higher point at the centre
        dem[15, 15] = 310.0
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 30, 30)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        # With a large min_distance, peaks on the ridge should be merged
        results = detect_hilltops(dem, meta, min_prominence_m=1.0, min_distance_km=5.0)
        assert len(results) >= 1
        # The highest point on the ridge survives
        assert results[0]["elevation_m"] == 310.0

    def test_crater(self):
        """A crater (ring of high terrain with low centre) detects rim peaks."""
        dem = np.full((30, 30), 100.0, dtype=np.float32)
        # Rim at rows/cols 10-20, except centre
        for r in range(10, 21):
            for c in range(10, 21):
                if (r - 15) ** 2 + (c - 15) ** 2 <= 25:  # inside
                    dem[r, c] = 150.0  # rim
        dem[15, 15] = 50.0  # crater centre (lower)
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 30, 30)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        results = detect_hilltops(dem, meta, min_prominence_m=5.0)
        # Should detect rim peaks (not the low centre)
        for r in results:
            assert r["elevation_m"] > 100.0, "All peaks should be on the rim"

    # --- Edge of DEM ------------------------------------------------------

    def test_peak_at_edge_detected(self):
        """A peak right at the DEM edge should still be detected."""
        dem = np.full((10, 10), 100.0, dtype=np.float32)
        dem[0, 0] = 500.0  # Top-left corner peak
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        results = detect_hilltops(dem, meta, min_prominence_m=10.0, min_distance_km=100.0)
        assert len(results) == 1
        assert results[0]["elevation_m"] == 500.0

    # --- No metadata keys missing -----------------------------------------

    def test_missing_affine_raises(self):
        """Missing 'affine' key raises KeyError."""
        with pytest.raises(KeyError):
            detect_hilltops(
                np.zeros((10, 10), dtype=np.float32),
                {"crs": "EPSG:4326"},
            )

    # --- Large DEM stress test (small) ------------------------------------

    def test_larger_dem_no_crash(self):
        """A moderately large DEM processes without error."""
        np.random.seed(42)
        rows, cols = 100, 100
        dem = np.random.rand(rows, cols).astype(np.float32) * 500.0
        affine = from_bounds(-82.6, 35.5, -82.4, 35.7, cols, rows)
        meta = {"affine": affine, "crs": "EPSG:4326"}

        results = detect_hilltops(dem, meta, min_prominence_m=50.0)
        assert isinstance(results, list)
        for r in results:
            assert -82.6 <= r["lon"] <= -82.4
            assert 35.5 <= r["lat"] <= 35.7
            assert 0.0 <= r["elevation_m"] <= 500.0
