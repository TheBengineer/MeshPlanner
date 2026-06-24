"""Tests for optimize module."""

import numpy as np
import pytest
from scipy.sparse import csr_matrix

from meshplanner.optimize import build_coverage_matrix

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def basic_rasters():
    """Three 5x5 rasters with known patterns (same as test_combine).

    Raster A: strong signal in upper-left quadrant
    Raster B: strong signal in lower-right quadrant
    Raster C: strong signal in a vertical stripe down the middle
    """
    A = np.full((5, 5), -np.inf, dtype=np.float32)
    A[:3, :3] = -70.0

    B = np.full((5, 5), -np.inf, dtype=np.float32)
    B[2:, 2:] = -80.0

    C = np.full((5, 5), -np.inf, dtype=np.float32)
    C[:, 2] = -60.0

    return {"Alpha": A, "Bravo": B, "Charlie": C}


@pytest.fixture
def single_raster():
    """A single-site raster (2x3) with coverage in the top row."""
    r = np.full((2, 3), -np.inf, dtype=np.float32)
    r[0, :] = -90.0  # entire top row covered
    return {"Solo": r}


@pytest.fixture
def all_inf_rasters():
    """Two all--inf rasters (no coverage anywhere)."""
    A = np.full((4, 4), -np.inf, dtype=np.float32)
    B = np.full((4, 4), -np.inf, dtype=np.float32)
    return {"DeadA": A, "DeadB": B}


@pytest.fixture
def shaped_rasters():
    """Three 4x4 rasters for downsample testing.

    Raster X: every pixel covered
    Raster Y: checkerboard pattern
    Raster Z: only a single pixel (0,0) covered
    """
    X = np.full((4, 4), -100.0, dtype=np.float32)

    Y = np.full((4, 4), -np.inf, dtype=np.float32)
    Y[::2, ::2] = -90.0
    Y[1::2, 1::2] = -90.0

    Z = np.full((4, 4), -np.inf, dtype=np.float32)
    Z[0, 0] = -90.0

    return {"Xray": X, "Yankee": Y, "Zulu": Z}


# ---------------------------------------------------------------------------
# build_coverage_matrix — basic structure
# ---------------------------------------------------------------------------


class TestBuildCoverageMatrixStructure:
    def test_return_types(self, basic_rasters):
        """Return type is (csr_matrix, list, int)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        assert isinstance(M, csr_matrix)
        assert isinstance(names, list)
        assert isinstance(n_cells, int)

    def test_matrix_shape(self, basic_rasters):
        """Shape is (N_sites, H*W)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        assert M.shape == (3, 25)
        assert n_cells == 25

    def test_site_names_order(self, basic_rasters):
        """Site names match input dict order and matrix rows."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        assert names == ["Alpha", "Bravo", "Charlie"]
        assert M.shape[0] == len(names)

    def test_binary_values(self, basic_rasters):
        """Matrix entries are 0 or 1."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        assert np.all(M.data == 1.0)
        assert np.all(M.toarray() >= 0) and np.all(M.toarray() <= 1)

    def test_sparse_property(self, basic_rasters):
        """Matrix should be sparse (stored as CSR)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        assert M.format == "csr"
        # Should have fewer stored entries than full dense size
        assert M.nnz < M.shape[0] * M.shape[1]


# ---------------------------------------------------------------------------
# build_coverage_matrix — coverage correctness
# ---------------------------------------------------------------------------


class TestBuildCoverageMatrixCorrectness:
    def test_site_a_coverage(self, basic_rasters):
        """Alpha covers upper-left 3x3 (9 cells)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        dense = M.toarray()
        row_a = dense[0]  # Alpha
        row_a_2d = row_a.reshape(5, 5)
        assert np.all(row_a_2d[:3, :3] == 1)  # upper-left 3x3
        assert np.all(row_a_2d[3:, :] == 0)  # rest uncovered

    def test_site_b_coverage(self, basic_rasters):
        """Bravo covers lower-right 3x3 (9 cells)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        dense = M.toarray()
        row_b = dense[1]  # Bravo
        row_b_2d = row_b.reshape(5, 5)
        assert np.all(row_b_2d[2:, 2:] == 1)  # lower-right 3x3
        assert np.all(row_b_2d[:2, :] == 0)  # rest uncovered

    def test_site_c_coverage(self, basic_rasters):
        """Charlie covers middle column (5 cells)."""
        M, names, n_cells = build_coverage_matrix(basic_rasters)
        dense = M.toarray()
        row_c = dense[2]  # Charlie
        row_c_2d = row_c.reshape(5, 5)
        assert np.all(row_c_2d[:, 2] == 1)  # middle column
        row_c_2d[:, 2] = 0
        assert np.all(row_c_2d == 0)  # everything else uncovered

    def test_no_covered_cells_gives_empty_rows(self, all_inf_rasters):
        """All--inf rasters → all rows are all-zero."""
        M, names, n_cells = build_coverage_matrix(all_inf_rasters)
        dense = M.toarray()
        assert np.all(dense == 0)
        assert M.nnz == 0

    def test_single_site(self, single_raster):
        """Single site → 1-row matrix."""
        M, names, n_cells = build_coverage_matrix(single_raster)
        assert M.shape == (1, 6)
        assert names == ["Solo"]
        dense = M.toarray().reshape(2, 3)
        assert np.all(dense[0, :] == 1)  # top row covered
        assert np.all(dense[1, :] == 0)  # bottom row not

    def test_threshold_filtering(self):
        """RSSI values below threshold are excluded."""
        r = np.array([[-100.0, -125.0, -130.0], [-90.0, -80.0, -200.0]], dtype=np.float32)
        rasters = {"Site": r}
        M, names, n_cells = build_coverage_matrix(rasters, threshold_dbm=-120.0)
        # Cells covered: (0,0) = -100 >= -120 ✓
        #               (1,0) = -90  >= -120 ✓
        #               (1,1) = -80  >= -120 ✓
        #               others below threshold
        dense = M.toarray().reshape(2, 3)
        assert dense[0, 0] == 1
        assert dense[1, 0] == 1
        assert dense[1, 1] == 1
        assert dense[0, 1] == 0
        assert dense[0, 2] == 0
        assert dense[1, 2] == 0


# ---------------------------------------------------------------------------
# build_coverage_matrix — downsampling
# ---------------------------------------------------------------------------


class TestBuildCoverageMatrixDownsampling:
    def test_cell_size_1_no_change(self, basic_rasters):
        """cell_size_px=1 is same as default (no downsampling)."""
        M1, _, n1 = build_coverage_matrix(basic_rasters, cell_size_px=1)
        M2, _, n2 = build_coverage_matrix(basic_rasters)
        assert n1 == n2
        assert (M1 != M2).nnz == 0

    def test_cell_size_2_reduces_cells(self, shaped_rasters):
        """cell_size_px=2 reduces cell count to (2x2) = 4."""
        M, names, n_cells = build_coverage_matrix(shaped_rasters, cell_size_px=2)
        # Input 4x4 → 2x2 blocks → 2x2 output = 4 cells
        assert n_cells == 4
        assert M.shape == (3, 4)

    def test_cell_size_2_any_aggregation(self, shaped_rasters):
        """Block is covered if ANY pixel in the block is covered.

        Xray: all pixels covered → all 4 blocks covered.
        Zulu: only (0,0) covered → only block (0,0) covered.
        """
        M, names, n_cells = build_coverage_matrix(shaped_rasters, cell_size_px=2)
        dense = M.toarray()

        # Xray (row 0): all blocks covered (every pixel is covered)
        assert np.all(dense[0] == 1)

        # Zulu (row 2): only pixel (0,0) covered → only block (0,0) covered
        assert dense[2, 0] == 1  # block containing (0,0) is covered
        assert np.all(dense[2, 1:] == 0)  # other blocks not covered

    def test_cell_size_2_checkerboard(self, shaped_rasters):
        """Yankee: checkerboard pattern (every other pixel covered).

        4x4 with pixels at (0,0), (0,2), (1,1), (1,3), (2,0), (2,2),
        (3,1), (3,3) covered.  With 2x2 blocks:
          Block (0,0): pixels (0,0)=1, (0,1)=0, (1,0)=0, (1,1)=1 → covered
          Block (0,1): pixels (0,2)=1, (0,3)=0, (1,2)=0, (1,3)=1 → covered
          Block (1,0): pixels (2,0)=1, (2,1)=0, (3,0)=0, (3,1)=1 → covered
          Block (1,1): pixels (2,2)=1, (2,3)=0, (3,2)=0, (3,3)=1 → covered
        So all 4 blocks should be covered.
        """
        M, names, n_cells = build_coverage_matrix(shaped_rasters, cell_size_px=2)
        dense = M.toarray()
        assert np.all(dense[1] == 1)  # Yankee: all blocks covered

    def test_cell_size_larger_than_raster(self):
        """cell_size_px larger than raster → single cell per site."""
        r = np.full((2, 3), -80.0, dtype=np.float32)
        rasters = {"Big": r}
        M, names, n_cells = build_coverage_matrix(rasters, cell_size_px=10)
        assert n_cells == 1
        assert M.shape == (1, 1)
        # Single block should be covered (all pixels >= threshold)
        assert M[0, 0] == 1.0

    def test_cell_size_3_non_divisible(self):
        """cell_size_px=3 on 5x5 → 2x2 output blocks (padding)."""
        r = np.full((5, 5), -np.inf, dtype=np.float32)
        r[0, 0] = -80.0  # only top-left corner covered
        rasters = {"Corner": r}
        M, names, n_cells = build_coverage_matrix(rasters, cell_size_px=3)
        # ceil(5/3) = 2, so 2x2 = 4 cells
        assert n_cells == 4
        dense = M.toarray().reshape(2, 2)
        # Block (0,0) contains pixel (0,0) which is covered
        assert dense[0, 0] == 1
        # Other blocks not covered
        assert np.all(dense[0, 1:] == 0)
        assert np.all(dense[1, :] == 0)

    def test_cell_size_3_coverage_within_block(self):
        """Coverage in a padded region still triggers block coverage."""
        r = np.full((5, 5), -np.inf, dtype=np.float32)
        # pixel (4,4) is in the last block (1,1) with block size 3
        # blocks are: rows 0-2, 3-4 (padded) and cols 0-2, 3-4 (padded)
        # pixel (4,4) is in block (1,1)
        r[4, 4] = -90.0
        rasters = {"Edge": r}
        M, names, n_cells = build_coverage_matrix(rasters, cell_size_px=3)
        dense = M.toarray().reshape(2, 2)
        assert dense[1, 1] == 1  # block containing (4,4) is covered
        assert dense[0, 0] == 0  # other blocks not


# ---------------------------------------------------------------------------
# build_coverage_matrix — input validation
# ---------------------------------------------------------------------------


class TestBuildCoverageMatrixValidation:
    def test_empty_dict_raises(self):
        """Empty rasters dict raises ValueError."""
        with pytest.raises(ValueError, match="At least one raster"):
            build_coverage_matrix({})

    def test_cell_size_less_than_1_raises(self):
        """cell_size_px < 1 raises ValueError."""
        r = np.zeros((2, 2), dtype=np.float32)
        with pytest.raises(ValueError, match="cell_size_px"):
            build_coverage_matrix({"A": r}, cell_size_px=0)

    def test_cell_size_negative_raises(self):
        """cell_size_px negative raises ValueError."""
        r = np.zeros((2, 2), dtype=np.float32)
        with pytest.raises(ValueError, match="cell_size_px"):
            build_coverage_matrix({"A": r}, cell_size_px=-1)

    def test_shape_mismatch_raises(self):
        """Rasters with different shapes raise ValueError."""
        A = np.zeros((3, 3), dtype=np.float32)
        B = np.zeros((4, 3), dtype=np.float32)
        with pytest.raises(ValueError, match="Raster 1 has shape"):
            build_coverage_matrix({"A": A, "B": B})

    def test_non_2d_raster_raises(self):
        """1-D or 3-D arrays raise ValueError."""
        r = np.zeros(10, dtype=np.float32)
        with pytest.raises(ValueError, match="Expected 2-D"):
            build_coverage_matrix({"A": r})


# ---------------------------------------------------------------------------
# build_coverage_matrix — edge cases
# ---------------------------------------------------------------------------


class TestBuildCoverageMatrixEdgeCases:
    def test_one_site_no_coverage(self):
        """Single site with no coverage → all-zero row."""
        r = np.full((3, 3), -np.inf, dtype=np.float32)
        M, names, n_cells = build_coverage_matrix({"Empty": r})
        assert M.nnz == 0
        assert np.all(M.toarray() == 0)

    def test_all_sites_full_coverage(self):
        """All sites cover everything → dense matrix with all-1 rows."""
        A = np.full((2, 2), -50.0, dtype=np.float32)
        B = np.full((2, 2), -60.0, dtype=np.float32)
        M, names, n_cells = build_coverage_matrix({"A": A, "B": B})
        dense = M.toarray()
        assert np.all(dense == 1)
        assert n_cells == 4

    def test_threshold_at_boundary(self):
        """RSSI exactly equal to threshold counts as covered."""
        r = np.array([[-120.0, -121.0]], dtype=np.float32)
        M, names, n_cells = build_coverage_matrix({"Bound": r}, threshold_dbm=-120.0)
        dense = M.toarray().reshape(1, 2)
        assert dense[0, 0] == 1  # exactly -120, covered
        assert dense[0, 1] == 0  # -121 < -120, not covered

    def test_different_threshold(self):
        """Coverage changes with stricter (-110) threshold."""
        A = np.full((2, 2), -100.0, dtype=np.float32)
        B = np.full((2, 2), -115.0, dtype=np.float32)
        rasters = {"Strong": A, "Weak": B}

        # At -110 threshold: A covers, B does not
        M, names, n_cells = build_coverage_matrix(rasters, threshold_dbm=-110.0)
        dense = M.toarray()
        assert np.all(dense[0] == 1)  # Strong: all covered
        assert np.all(dense[1] == 0)  # Weak: none covered

        # At -120 threshold: both cover
        M, names, n_cells = build_coverage_matrix(rasters, threshold_dbm=-120.0)
        dense = M.toarray()
        assert np.all(dense[0] == 1)  # Strong: all covered
        assert np.all(dense[1] == 1)  # Weak: all covered

    def test_many_sites_sparse(self):
        """Many sites with small coverage → few nonzero entries."""
        rasters = {}
        for i in range(50):
            r = np.full((10, 10), -np.inf, dtype=np.float32)
            r[i % 10, i // 10] = -90.0  # each site covers exactly 1 cell
            rasters[f"Site{i}"] = r

        M, names, n_cells = build_coverage_matrix(rasters)
        assert M.shape == (50, 100)
        assert M.nnz == 50  # each site covers exactly 1 cell
