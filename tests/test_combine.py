"""Tests for the combine/union module."""

import numpy as np
import pytest

from meshplanner.combine.union import (
    combine_at_threshold,
    combine_coverage,
    compute_redundancy,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def basic_rasters():
    """Three 5×5 rasters with known patterns.

    Raster A: strong signal in upper-left quadrant
    Raster B: strong signal in lower-right quadrant
    Raster C: strong signal in a vertical stripe down the middle
    """
    A = np.full((5, 5), -np.inf, dtype=np.float32)
    A[:3, :3] = -70.0  # upper-left

    B = np.full((5, 5), -np.inf, dtype=np.float32)
    B[2:, 2:] = -80.0  # lower-right

    C = np.full((5, 5), -np.inf, dtype=np.float32)
    C[:, 2] = -60.0  # middle column

    return [A, B, C]


@pytest.fixture
def same_value_rasters():
    """Two rasters with the same coverage pattern."""
    A = np.full((3, 3), -90.0, dtype=np.float32)
    A[0, 0] = -np.inf
    B = np.full((3, 3), -90.0, dtype=np.float32)
    B[0, 0] = -np.inf
    return [A, B]


# ---------------------------------------------------------------------------
# combine_coverage
# ---------------------------------------------------------------------------


class TestCombineCoverage:
    def test_best_method(self, basic_rasters):
        """Best RSSI per cell — picks the strongest signal."""
        A, B, C = basic_rasters
        result = combine_coverage([A, B, C], method="best")

        # Fixture maps (5x5 arrays):
        #   A[:3,:3] = -70,  B[2:,2:] = -80,  C[:,2] = -60
        # (2,2): all three sites → max(-70, -80, -60) = -60
        assert result[2, 2] == -60.0
        # (0,2): A=-70, C=-60 → max = -60
        assert result[0, 2] == -60.0
        # (0,0): only A=-70 → -70
        assert result[0, 0] == -70.0
        # (4,4): only B=-80 → -80
        assert result[4, 4] == -80.0
        # (3,3): only B=-80 → -80
        assert result[3, 3] == -80.0

    def test_mean_method(self, basic_rasters):
        """Mean RSSI per cell — averages only covering sites."""
        A, B, C = basic_rasters
        result = combine_coverage([A, B, C], method="mean")

        # (2,2): A=-70, B=-80, C=-60 → mean = -70.0
        assert result[2, 2] == pytest.approx(-70.0)
        # (0,2): A=-70, C=-60 → mean = -65.0
        assert result[0, 2] == pytest.approx(-65.0)
        # (0,0): only A=-70 → mean = -70.0
        assert result[0, 0] == -70.0
        # (4,4): only B=-80 → mean = -80.0
        assert result[4, 4] == -80.0
        # (0,4): uncovered by all → -inf
        assert np.isneginf(result[0, 4])

    def test_worst_method(self, basic_rasters):
        """Worst RSSI per cell — picks the weakest covering signal."""
        A, B, C = basic_rasters
        result = combine_coverage([A, B, C], method="worst")

        # (2,2): min(-70, -80, -60) = -80
        assert result[2, 2] == -80.0
        # (0,2): min(-70, -60) = -70
        assert result[0, 2] == -70.0
        # (0,0): only A=-70 → -70
        assert result[0, 0] == -70.0
        # (4,4): only B=-80 → -80
        assert result[4, 4] == -80.0

    def test_single_raster(self):
        """Single raster is returned unchanged (minus -inf-filled)."""
        r = np.full((4, 4), -85.0, dtype=np.float32)
        r[0, 0] = -np.inf
        result = combine_coverage([r], method="best")
        assert np.allclose(result, r)
        assert result is not r  # should be a copy

    def test_empty_list_raises(self):
        """Empty raster list raises ValueError."""
        with pytest.raises(ValueError, match="At least one raster"):
            combine_coverage([], method="best")

    def test_shape_mismatch_raises(self):
        """Rasters with different shapes raise ValueError."""
        A = np.zeros((3, 3), dtype=np.float32)
        B = np.zeros((4, 3), dtype=np.float32)
        with pytest.raises(ValueError, match="Raster 1 has shape"):
            combine_coverage([A, B], method="best")

    def test_invalid_method_raises(self):
        """Unknown method raises ValueError."""
        r = np.zeros((2, 2), dtype=np.float32)
        with pytest.raises(ValueError, match="Unknown method"):
            combine_coverage([r, r], method="median")

    def test_all_inf(self, basic_rasters):
        """All -inf cells in every raster → result is -inf."""
        A = np.full((3, 3), -np.inf, dtype=np.float32)
        B = np.full((3, 3), -np.inf, dtype=np.float32)
        result = combine_coverage([A, B], method="best")
        assert np.all(np.isneginf(result))

    def test_all_inf_mean(self):
        """Mean of all -inf cells → -inf (no covering sites)."""
        A = np.full((3, 3), -np.inf, dtype=np.float32)
        B = np.full((3, 3), -np.inf, dtype=np.float32)
        result = combine_coverage([A, B], method="mean")
        assert np.all(np.isneginf(result))


# ---------------------------------------------------------------------------
# combine_at_threshold
# ---------------------------------------------------------------------------


class TestCombineAtThreshold:
    def test_union(self, basic_rasters):
        """Union: True if ANY site covers the cell."""
        A, B, C = basic_rasters
        result = combine_at_threshold([A, B, C], threshold_dbm=-100.0, require="any")

        # (0,0): covered by A and C → True
        assert result[0, 0]
        # (4,4): covered by B → True
        assert result[4, 4]
        # (0,4): not covered by any → False
        assert not result[0, 4]

    def test_intersection(self, basic_rasters):
        """Intersection: True only if ALL sites cover the cell."""
        A, B, C = basic_rasters
        result = combine_at_threshold([A, B, C], threshold_dbm=-200.0, require="all")

        # (0,0): A=-70, B=-inf, C=-60 → not all cover (B is -inf)
        # But -inf >= -200 is False in numpy
        assert not result[0, 0]

    def test_intersection_all_cover(self):
        """Intersection where all sites cover a region."""
        A = np.full((3, 3), -90.0, dtype=np.float32)
        B = np.full((3, 3), -85.0, dtype=np.float32)
        result = combine_at_threshold([A, B], threshold_dbm=-100.0, require="all")
        assert np.all(result)

    def test_union_no_coverage(self):
        """Union with no coverage anywhere → all False."""
        A = np.full((3, 3), -np.inf, dtype=np.float32)
        B = np.full((3, 3), -np.inf, dtype=np.float32)
        result = combine_at_threshold([A, B], threshold_dbm=-120.0, require="any")
        assert not np.any(result)

    def test_empty_list_raises(self):
        with pytest.raises(ValueError, match="At least one raster"):
            combine_at_threshold([], threshold_dbm=-120.0, require="any")

    def test_shape_mismatch_raises(self):
        A = np.zeros((3, 3), dtype=np.float32)
        B = np.zeros((4, 3), dtype=np.float32)
        with pytest.raises(ValueError, match="Raster 1 has shape"):
            combine_at_threshold([A, B], threshold_dbm=-120.0, require="any")

    def test_invalid_require_raises(self):
        r = np.zeros((2, 2), dtype=np.float32)
        with pytest.raises(ValueError, match="Unknown require"):
            combine_at_threshold([r, r], threshold_dbm=-120.0, require="maybe")


# ---------------------------------------------------------------------------
# compute_redundancy
# ---------------------------------------------------------------------------


class TestComputeRedundancy:
    def test_basic_count(self, basic_rasters):
        """Correctly counts sites covering each cell."""
        A, B, C = basic_rasters
        result = compute_redundancy([A, B, C], threshold_dbm=-100.0)

        # Fixture: A[:3,:3]=-70, B[2:,2:]=-80, C[:,2]=-60
        # (2,2): A=-70, B=-80, C=-60 → 3 (all three cover it)
        assert result[2, 2] == 3
        # (0,2): A=-70, C=-60 → 2
        assert result[0, 2] == 2
        # (0,0): A=-70 only → 1
        assert result[0, 0] == 1
        # (4,4): B=-80 only → 1
        assert result[4, 4] == 1
        # (0,4): all -inf → 0
        assert result[0, 4] == 0
        # (3,3): B=-80 only → 1
        assert result[3, 3] == 1

    def test_all_uncovered(self):
        """No coverage anywhere → all zeros."""
        A = np.full((3, 3), -np.inf, dtype=np.float32)
        B = np.full((3, 3), -np.inf, dtype=np.float32)
        result = compute_redundancy([A, B], threshold_dbm=-120.0)
        assert np.all(result == 0)

    def test_all_covered_by_all(self, same_value_rasters):
        """Every cell covered by both sites → count == 2."""
        result = compute_redundancy(same_value_rasters, threshold_dbm=-100.0)
        assert result[1, 1] == 2
        assert result[0, 0] == 0  # no coverage from either

    def test_four_sites(self):
        """Four sites, some cells covered by varying counts."""
        A = np.full((2, 2), -50.0, dtype=np.float32)
        B = np.full((2, 2), -50.0, dtype=np.float32)
        B[0, 0] = -np.inf
        C = np.full((2, 2), -np.inf, dtype=np.float32)
        C[0, :] = -50.0
        D = np.full((2, 2), -np.inf, dtype=np.float32)

        result = compute_redundancy([A, B, C, D], threshold_dbm=-80.0)
        # (0,0): A, C = 2
        assert result[0, 0] == 2
        # (0,1): A, B, C = 3
        assert result[0, 1] == 3
        # (1,0): A=-50, B=-50, C=-inf (C only row 0), D=-inf → 2
        assert result[1, 0] == 2
        # (1,1): A, B = 2
        assert result[1, 1] == 2

    def test_empty_list_raises(self):
        with pytest.raises(ValueError, match="At least one raster"):
            compute_redundancy([], threshold_dbm=-120.0)

    def test_shape_mismatch_raises(self):
        A = np.zeros((3, 3), dtype=np.float32)
        B = np.zeros((4, 3), dtype=np.float32)
        with pytest.raises(ValueError, match="Raster 1 has shape"):
            compute_redundancy([A, B], threshold_dbm=-120.0)

    def test_return_type(self, basic_rasters):
        """Result must be integer array."""
        result = compute_redundancy(basic_rasters, threshold_dbm=-100.0)
        assert result.dtype == np.int32 or result.dtype == np.int64
