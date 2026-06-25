"""Tests for optimize module."""

import numpy as np
import pytest
from scipy.sparse import csr_matrix

from meshplanner.optimize import build_coverage_matrix
from meshplanner.optimize.greedy import greedy_max_coverage, greedy_min_sites

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


# ---------------------------------------------------------------------------
# Helpers for greedy tests
# ---------------------------------------------------------------------------


def _make_csr(site_cells: list[list[int]], n_cells: int) -> csr_matrix:
    """Build a binary CSR matrix from explicit per-site column lists."""
    rows: list[int] = []
    cols: list[int] = []
    for site_idx, cells in enumerate(site_cells):
        rows.extend([site_idx] * len(cells))
        cols.extend(cells)
    data = np.ones(len(rows), dtype=np.float64)
    return csr_matrix(
        (data, (rows, cols)), shape=(len(site_cells), n_cells), dtype=np.float64
    )


# ---------------------------------------------------------------------------
# Greedy — greedy_min_sites
# ---------------------------------------------------------------------------


class TestGreedyMinSites:
    """Tests for greedy_min_sites (set-cover style)."""

    # Coverage matrix (deterministic, no ties):
    #   4 sites, 12 cells
    #   A: {0,1,2,3,4}     (5 cells)
    #   B: {2,3,4,5,6,7}   (6 cells)
    #   C: {6,7,8}         (3 cells)
    #   D: {9,10,11}       (3 cells)
    #
    # Greedy order: B → D → A → C
    #   After B: 6/12 = 0.500
    #   After D: 9/12 = 0.750
    #   After A: 11/12 = 0.917
    #   After C: 12/12 = 1.000

    _N_CELLS = 12
    _SITE_NAMES = ["Alpha", "Bravo", "Charlie", "Delta"]
    _COVERAGE = _make_csr(
        [
            [0, 1, 2, 3, 4],        # Alpha
            [2, 3, 4, 5, 6, 7],     # Bravo
            [6, 7, 8],              # Charlie
            [9, 10, 11],            # Delta
        ],
        _N_CELLS,
    )

    def test_return_structure(self):
        """Return dict has expected keys and types."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 0.5)
        assert isinstance(result, dict)
        assert "selected_sites" in result
        assert "covered_fraction" in result
        assert "iterations" in result
        assert isinstance(result["selected_sites"], list)
        assert isinstance(result["covered_fraction"], float)
        assert isinstance(result["iterations"], int)

    def test_target_50_pct(self):
        """target=0.50 selects Bravo alone (6/12 = 0.5)."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 0.50)
        assert result["selected_sites"] == ["Bravo"]
        assert result["covered_fraction"] == 0.5
        assert result["iterations"] == 1

    def test_target_75_pct(self):
        """target=0.75 selects Bravo + Delta (9/12 = 0.75)."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 0.75)
        assert result["selected_sites"] == ["Bravo", "Delta"]
        assert result["covered_fraction"] == 0.75
        assert result["iterations"] == 2

    def test_target_100_pct(self):
        """target=1.0 selects all 4 sites."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 1.0)
        assert result["selected_sites"] == ["Bravo", "Delta", "Alpha", "Charlie"]
        assert result["covered_fraction"] == 1.0
        assert result["iterations"] == 4

    def test_target_zero(self):
        """target <= 0 returns empty selection."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 0.0)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_target_negative(self):
        """Negative target returns empty selection."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, -0.1)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_target_above_1(self):
        """target > 1 is clamped to 1.0."""
        result = greedy_min_sites(self._COVERAGE, self._SITE_NAMES, 1.5)
        assert result["iterations"] == 4
        assert result["covered_fraction"] == 1.0

    def test_no_coverage_matrix(self):
        """All-inf rasters → no cells covered → empty result."""
        M = _make_csr([[], [], []], 10)
        names = ["X", "Y", "Z"]
        result = greedy_min_sites(M, names, 0.95)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_empty_site_list(self):
        """Empty coverage matrix (0 sites) returns empty result."""
        M = csr_matrix((0, 10), dtype=np.float64)
        result = greedy_min_sites(M, [], 0.95)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_site_covers_everything(self):
        """Single site covering all cells → selected in one iteration."""
        M = _make_csr([list(range(20))], 20)
        result = greedy_min_sites(M, ["Omni"], 0.95)
        assert result["selected_sites"] == ["Omni"]
        assert result["covered_fraction"] == 1.0
        assert result["iterations"] == 1

    def test_target_exceeds_achievable(self):
        """Target higher than what all sites together can achieve → exhaust all."""
        # Two sites, 10 cells, each covers 3 disjoint cells → max 6/10 = 0.6
        M = _make_csr([[0, 1, 2], [3, 4, 5]], 10)
        result = greedy_min_sites(M, ["A", "B"], 0.9)
        assert result["selected_sites"] == ["A", "B"]
        assert result["covered_fraction"] == 0.6
        assert result["iterations"] == 2

    def test_all_sites_identical(self):
        """All sites cover the same cells → first one selected is enough."""
        M = _make_csr([[0, 1, 2], [0, 1, 2], [0, 1, 2]], 10)
        result = greedy_min_sites(M, ["A", "B", "C"], 0.5)
        assert result["selected_sites"] == ["A"]
        assert result["covered_fraction"] == 0.3
        assert result["iterations"] == 1

    def test_selection_order_by_gain(self):
        """Sites are selected in decreasing-gain order, not arbitrary."""
        # A covers 2, B covers 1, C covers 5, D covers 3
        M = _make_csr([[0, 1], [2], [3, 4, 5, 6, 7], [8, 9, 10]], 11)
        names = ["SmallA", "SmallB", "LargeC", "MediumD"]
        result = greedy_min_sites(M, names, 1.0)
        assert result["selected_sites"][0] == "LargeC"  # gain 5
        assert result["selected_sites"][1] == "MediumD"  # gain 3
        # SmallA (2) and SmallB (1) in remaining order
        assert len(result["selected_sites"]) == 4

    def test_partial_overlap_higher_gain_wins(self):
        """A site with more total cells but significant overlap can be beaten
        by a smaller site with less overlap."""
        # A covers cells 0-7 (8 cells)
        # B covers cells 0-3 (4 cells, all inside A)
        # C covers cells 8-11 (4 cells, no overlap)
        M = _make_csr([list(range(8)), list(range(4)), [8, 9, 10, 11]], 12)
        names = ["Big", "Subset", "Disjoint"]
        # Round 1: Big=8, Subset=4, Disjoint=4 → Big wins
        result = greedy_min_sites(M, names, 0.5)
        assert result["selected_sites"][0] == "Big"
        assert result["covered_fraction"] == 8 / 12


# ---------------------------------------------------------------------------
# Greedy — greedy_max_coverage
# ---------------------------------------------------------------------------


class TestGreedyMaxCoverage:
    """Tests for greedy_max_coverage (pick exactly N sites)."""

    _N_CELLS = 12
    _SITE_NAMES = ["Alpha", "Bravo", "Charlie", "Delta"]
    _COVERAGE = _make_csr(
        [
            [0, 1, 2, 3, 4],        # Alpha (5)
            [2, 3, 4, 5, 6, 7],     # Bravo (6)
            [6, 7, 8],              # Charlie (3)
            [9, 10, 11],            # Delta (3)
        ],
        _N_CELLS,
    )

    def test_return_structure(self):
        """Return dict has expected keys and types."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 1)
        assert isinstance(result, dict)
        assert "selected_sites" in result
        assert "covered_fraction" in result
        assert "iterations" in result

    def test_pick_one_site(self):
        """Best single site is Bravo (covers 6 cells)."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 1)
        assert result["selected_sites"] == ["Bravo"]
        assert result["covered_fraction"] == 0.5
        assert result["iterations"] == 1

    def test_pick_two_sites(self):
        """Best two sites are Bravo + Delta (9 cells)."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 2)
        assert result["selected_sites"] == ["Bravo", "Delta"]
        assert result["covered_fraction"] == 0.75
        assert result["iterations"] == 2

    def test_pick_three_sites(self):
        """Best three sites are Bravo + Delta + Alpha (11 cells)."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 3)
        assert result["selected_sites"] == ["Bravo", "Delta", "Alpha"]
        assert result["covered_fraction"] == 11 / 12
        assert result["iterations"] == 3

    def test_pick_all_sites_explicit(self):
        """n_sites = N_sites returns all sites."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 4)
        assert len(result["selected_sites"]) == 4
        assert result["covered_fraction"] == 1.0
        assert result["iterations"] == 4

    def test_pick_more_than_available(self):
        """n_sites > N_sites returns all sites."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 10)
        assert len(result["selected_sites"]) == 4
        assert result["covered_fraction"] == 1.0
        assert result["iterations"] == 4

    def test_zero_sites(self):
        """n_sites = 0 returns empty selection."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, 0)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_negative_sites(self):
        """Negative n_sites returns empty selection."""
        result = greedy_max_coverage(self._COVERAGE, self._SITE_NAMES, -1)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_no_coverage_matrix(self):
        """No site covers any cell → empty result even when N>0."""
        M = _make_csr([[], [], []], 10)
        result = greedy_max_coverage(M, ["X", "Y", "Z"], 2)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_empty_site_list(self):
        """Empty matrix returns empty result."""
        M = csr_matrix((0, 10), dtype=np.float64)
        result = greedy_max_coverage(M, [], 3)
        assert result["selected_sites"] == []
        assert result["covered_fraction"] == 0.0
        assert result["iterations"] == 0

    def test_exact_union_with_duplicates(self):
        """n_sites >= n_available returns all sites per shortcut (spec)."""
        M = _make_csr([[0, 1], [0, 1], [2, 3]], 10)
        names = ["X", "Y", "Z"]
        result = greedy_max_coverage(M, names, 3)
        # n_sites (3) >= n_available (3) → shortcut returns all sites
        assert result["selected_sites"] == ["X", "Y", "Z"]
        assert result["covered_fraction"] == 0.4
        assert result["iterations"] == 3

    def test_disjoint_sites(self):
        """Completely disjoint sites each contribute fully."""
        M = _make_csr([[0, 1], [2, 3], [4, 5]], 6)
        result = greedy_max_coverage(M, ["A", "B", "C"], 2)
        # All gains are 2; pick first two
        assert result["covered_fraction"] == 4 / 6
        assert result["iterations"] == 2
