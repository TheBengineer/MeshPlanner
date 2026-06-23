"""Tests for propagation module."""

import numpy as np
import pytest

from meshplanner.propagation.itm import (
    compute_path_loss,
    estimate_loss_from_profile,
    path_loss_at_fraction,
)
from meshplanner.propagation.params import (
    BAND_CENTERS,
    SF_SENSITIVITY,
    LinkBudget,
    LoraParams,
    estimate_range_km,
)


def test_propagation_imports():
    """Test that the propagation module can be imported."""
    assert True


# ── LoraParams tests ──────────────────────────────────────────


def test_lora_params_default():
    """Test default LoraParams values."""
    p = LoraParams()
    assert p.frequency_mhz == 915.0
    assert p.spreading_factor == 10
    assert p.rx_sensitivity_dbm == -132  # SF10 sensitivity
    assert p.tx_power_dbm == 20.0


def test_lora_params_from_band():
    """Test band preset creation."""
    p = LoraParams.from_band("EU868", spreading_factor=12)
    assert p.frequency_mhz == 868.0
    assert p.spreading_factor == 12
    assert p.rx_sensitivity_dbm == -137


def test_lora_params_explicit_sensitivity():
    """Test explicit sensitivity overrides automatic SF-based value."""
    p = LoraParams(spreading_factor=7, rx_sensitivity_dbm=-120)
    assert p.rx_sensitivity_dbm == -120  # overrides SF7 default of -123


def test_lora_params_invalid_sf():
    """Test invalid spreading factor raises ValueError."""
    with pytest.raises(ValueError, match="Spreading factor must be 7-12"):
        LoraParams(spreading_factor=13)


def test_lora_params_invalid_sf_low():
    """Test spreading factor below 7 raises ValueError."""
    with pytest.raises(ValueError, match="Spreading factor must be 7-12"):
        LoraParams(spreading_factor=6)


def test_lora_params_invalid_band():
    """Test invalid band name raises ValueError."""
    with pytest.raises(ValueError, match="Unknown band: INVALID"):
        LoraParams.from_band("INVALID")


def test_lora_params_invalid_frequency():
    """Test non-positive frequency raises ValueError."""
    with pytest.raises(ValueError, match="Frequency must be positive"):
        LoraParams(frequency_mhz=0)


def test_lora_params_all_bands():
    """Test that all band presets create valid params."""
    for band in BAND_CENTERS:
        p = LoraParams.from_band(band, spreading_factor=10)
        assert p.frequency_mhz == BAND_CENTERS[band]


def test_lora_params_all_sf_sensitivities():
    """Test that each spreading factor gets the correct sensitivity."""
    for sf, expected in SF_SENSITIVITY.items():
        p = LoraParams(spreading_factor=sf)
        assert p.rx_sensitivity_dbm == expected


def test_lora_params_tx_height_default():
    """Test default TX height."""
    p = LoraParams()
    assert p.tx_height_m == 10.0


def test_lora_params_rx_height_default():
    """Test default RX height."""
    p = LoraParams()
    assert p.rx_height_m == 1.5


# ── LinkBudget tests ──────────────────────────────────────────


def test_link_budget_feasible():
    """Test link budget with feasible link."""
    params = LoraParams(spreading_factor=10)
    budget = LinkBudget.calculate(params, path_loss_db=130.0)
    assert budget.is_feasible
    assert budget.margin_db > 0


def test_link_budget_not_feasible():
    """Test link budget with excessive path loss."""
    params = LoraParams(spreading_factor=10)
    budget = LinkBudget.calculate(params, path_loss_db=200.0)
    assert not budget.is_feasible
    assert budget.margin_db < 0


def test_link_budget_values():
    """Test link budget calculation values."""
    params = LoraParams(
        frequency_mhz=915.0,
        spreading_factor=10,
        tx_power_dbm=20.0,
        tx_antenna_gain_dbi=3.0,
    )
    # EIRP = 20 + 3 - 0.5 = 22.5 dBm
    # RX power = 22.5 - 140 + 0 - 0.5 = -118.0 dBm
    # Margin = -118.0 - (-132) = 14.0
    budget = LinkBudget.calculate(params, path_loss_db=140.0)
    assert budget.tx_eirp_dbm == 22.5
    assert budget.rx_power_dbm == -118.0
    assert budget.margin_db == 14.0
    assert budget.is_feasible


def test_link_budget_with_antenna_gains():
    """Test link budget with non-zero RX antenna gain."""
    params = LoraParams(
        spreading_factor=12,
        tx_power_dbm=17.0,
        tx_antenna_gain_dbi=6.0,
        rx_antenna_gain_dbi=3.0,
        cable_loss_tx_db=1.0,
        cable_loss_rx_db=1.0,
    )
    # EIRP = 17 + 6 - 1 = 22.0 dBm
    # RX power = 22.0 - 150 + 3 - 1 = -126.0 dBm
    # Margin = -126.0 - (-137) = 11.0
    budget = LinkBudget.calculate(params, path_loss_db=150.0)
    assert budget.tx_eirp_dbm == 22.0
    assert budget.rx_power_dbm == -126.0
    assert budget.margin_db == 11.0
    assert budget.is_feasible


def test_link_budget_margin_barely_feasible():
    """Test link budget where margin exactly equals required margin."""
    # EIRP = 20 + 3 - 0.5 = 22.5 dBm
    # RX power = 22.5 - path_loss + 0 - 0.5 = 22.0 - path_loss
    # For margin = 10: 22.0 - path_loss - (-132) = 10 → path_loss = 144.0
    params = LoraParams(
        spreading_factor=10,
        tx_power_dbm=20.0,
        tx_antenna_gain_dbi=3.0,
        required_margin_db=10.0,
    )
    budget = LinkBudget.calculate(params, path_loss_db=144.0)
    assert budget.margin_db == pytest.approx(10.0, abs=0.1)
    assert budget.is_feasible


def test_link_budget_str_output():
    """Test string representation of LinkBudget."""
    params = LoraParams(spreading_factor=10)
    budget = LinkBudget.calculate(params, path_loss_db=130.0)
    output = str(budget)
    assert "Link Budget" in output
    assert "FEASIBLE" in output
    assert "dBm" in output


def test_link_budget_str_not_feasible():
    """Test string representation of infeasible link."""
    params = LoraParams(spreading_factor=10)
    budget = LinkBudget.calculate(params, path_loss_db=200.0)
    output = str(budget)
    assert "NOT FEASIBLE" in output


# ── estimate_range_km tests ───────────────────────────────────


def test_estimate_range_default():
    """Test range estimation returns reasonable values."""
    params = LoraParams(spreading_factor=10, tx_power_dbm=20)
    range_km = estimate_range_km(params)
    assert 0 < range_km < 200  # Should be in km range for LoRa


def test_estimate_range_free_space():
    """Test free-space range is longer than suburban range."""
    params = LoraParams(spreading_factor=10, tx_power_dbm=20)
    fs_range = estimate_range_km(params, free_space=True)
    suburban_range = estimate_range_km(params, free_space=False)
    assert fs_range > suburban_range


def test_estimate_range_low_power_short():
    """Test low TX power with low SF gives short range."""
    params = LoraParams(spreading_factor=7, tx_power_dbm=0)
    range_km = estimate_range_km(params, free_space=False)
    assert 0 <= range_km < 50


def test_estimate_range_high_sf_shorter():
    """Test higher SF (worse sensitivity) gives shorter range."""
    params_sf7 = LoraParams(spreading_factor=7, tx_power_dbm=20)
    params_sf12 = LoraParams(spreading_factor=12, tx_power_dbm=20)
    r7 = estimate_range_km(params_sf7)
    r12 = estimate_range_km(params_sf12)
    # SF7 has worse sensitivity (-123 dBm) than SF12 (-137 dBm)
    # so SF7 should have a shorter range
    assert r7 < r12


def test_estimate_range_zero_path_loss():
    """Test that negative available path loss returns zero."""
    # TX power so low that available PL ≤ free-space PL at 1 km
    # Available PL = tx_power - 0.5 - rx_sensitivity - 10 - 0.5
    # For SF7 (sensitivity=-123): need tx_power < -20.4 dBm to get 0 range
    params = LoraParams(spreading_factor=7, tx_power_dbm=-30)
    range_km = estimate_range_km(params)
    assert range_km == 0.0


# ── ITM propagation tests ──────────────────────────────────────


@pytest.fixture
def flat_profile():
    """10 km flat terrain profile at sea level (100 sample points)."""
    num_points = 100
    dist_km = 10.0
    elevations = [0.0] * num_points
    return elevations, dist_km


@pytest.fixture
def hill_profile():
    """10 km profile with a 200 m hill in the middle."""
    num_points = 100
    dist_km = 10.0
    elevations = [0.0] * num_points
    for i in range(40, 61):
        if i <= 50:
            offset = (i - 40) / 10.0
        else:
            offset = (60 - i) / 10.0
        elevations[i] = 200.0 * offset
    return elevations, dist_km


def test_propagation_imports_itm():
    """Verify the itm module exports all expected symbols."""
    from meshplanner.propagation.itm import (
        CLIMATES,
        compute_path_loss,
        estimate_loss_from_profile,
        path_loss_at_fraction,
    )
    assert isinstance(CLIMATES, dict)
    assert "continental_temperate" in CLIMATES
    assert callable(compute_path_loss)
    assert callable(estimate_loss_from_profile)
    assert callable(path_loss_at_fraction)


def test_build_prop(flat_profile):
    """Verify prop dict structure built from elevations."""
    from meshplanner.propagation.itm import _build_prop

    elevations, dist_km = flat_profile
    prop = _build_prop(elevations, dist_km)

    # Core fields
    assert prop["pfl"][0] == len(elevations) - 1  # num_segments
    assert prop["pfl"][1] == pytest.approx(
        (dist_km * 1000.0) / (len(elevations) - 1)
    )
    assert len(prop["pfl"]) == len(elevations) + 2  # header + elevations
    assert prop["hg"] == [10.0, 1.5]
    assert prop["fmhz"] == 915.0
    assert prop["d"] == dist_km

    # Derived fields
    assert "wn" in prop
    assert "gme" in prop
    assert "zgnd" in prop
    assert prop["mdvarx"] == 11
    assert prop["klim"] == 5


def test_compute_path_loss_free_space(flat_profile):
    """Flat terrain path loss should be close to free space (excess small)."""
    elevations, dist_km = flat_profile
    result = compute_path_loss(elevations, dist_km)

    assert result["distance_km"] == dist_km
    assert result["frequency_mhz"] == 915.0
    assert result["free_space_loss_db"] == pytest.approx(111.7, abs=0.1)
    # Flat terrain: excess loss should be reasonable (20-40 dB range)
    assert 20 < result["excess_loss_db"] < 40
    # Total should be roughly free-space + small excess
    assert result["path_loss_db"] > result["free_space_loss_db"]


def test_compute_path_loss_mountain(hill_profile):
    """A large hill should produce significantly more loss than flat terrain."""
    flat_el, flat_dist = [0.0] * 100, 10.0
    flat_result = compute_path_loss(flat_el, flat_dist)

    hill_el, hill_dist = hill_profile
    hill_result = compute_path_loss(hill_el, hill_dist)

    assert hill_result["excess_loss_db"] > flat_result["excess_loss_db"] + 20
    assert hill_result["path_loss_db"] > flat_result["path_loss_db"] + 20


def test_compute_path_loss_zero_distance(flat_profile):
    """Zero distance should return free-space loss of 0 dB."""
    elevations, _ = flat_profile
    result = compute_path_loss(elevations, 0.0)
    assert result["free_space_loss_db"] == 0.0
    # Zero distance is degenerate; just verify it doesn't crash
    assert isinstance(result["path_loss_db"], float)


def test_path_loss_at_fraction_median(flat_profile):
    """fraction=0.5 should match the median from compute_path_loss."""
    elevations, dist_km = flat_profile
    median = path_loss_at_fraction(elevations, dist_km, fraction=0.5)
    full = compute_path_loss(elevations, dist_km)
    assert median == full["path_loss_db"]


def test_path_loss_at_fraction_extreme(flat_profile):
    """Lower quantiles (e.g., 0.1) should give less loss than higher (0.9)."""
    elevations, dist_km = flat_profile
    low = path_loss_at_fraction(elevations, dist_km, fraction=0.1)
    high = path_loss_at_fraction(elevations, dist_km, fraction=0.9)
    assert low < high


def test_estimate_loss_from_profile(flat_profile):
    """Convenience function should match direct compute_path_loss."""
    elevations, dist_km = flat_profile
    profile = {"elevations": elevations, "total_distance_km": dist_km}
    result = estimate_loss_from_profile(profile)
    direct = compute_path_loss(elevations, dist_km)
    assert result["path_loss_db"] == direct["path_loss_db"]
    assert result["free_space_loss_db"] == direct["free_space_loss_db"]


def test_compute_path_loss_different_params(flat_profile):
    """Varying frequency / height should change loss as expected."""
    elevations, dist_km = flat_profile

    # Higher frequency -> higher free-space loss
    r1 = compute_path_loss(elevations, dist_km, frequency_mhz=915.0)
    r2 = compute_path_loss(elevations, dist_km, frequency_mhz=2400.0)
    assert r2["free_space_loss_db"] > r1["free_space_loss_db"]

    # Higher TX antenna -> generally less loss (better clearance)
    r_low = compute_path_loss(elevations, dist_km, tx_height_m=5.0)
    r_high = compute_path_loss(elevations, dist_km, tx_height_m=50.0)
    # Higher antenna usually gives less excess loss (not guaranteed for
    # all terrain, but true for flat terrain)
    assert r_high["excess_loss_db"] <= r_low["excess_loss_db"] + 1.0


# ── Coverage radial sweep tests ──────────────────────────────────


def test_coverage_imports():
    """Verify coverage module exports."""
    from meshplanner.propagation.coverage import (  # noqa: F811
        _radial_points,
        compute_coverage_area,
        compute_coverage_at_threshold,
        compute_coverage_raster,
    )
    assert callable(compute_coverage_raster)
    assert callable(compute_coverage_at_threshold)
    assert callable(compute_coverage_area)
    assert callable(_radial_points)


def test_radial_points_fixed_angle():
    """Radial at 0 deg (north) from known point."""
    from meshplanner.propagation.coverage import _radial_points

    # From Asheville center, go north along 0 deg bearing
    points = _radial_points(35.6, -82.5, 0.0, max_range_km=1.0, step_km=0.5)

    assert len(points) >= 2
    # First point should be TX location
    assert points[0] == (35.6, -82.5, 0.0)
    # Second point should be north of TX (lat increases)
    assert points[1][0] > 35.6
    assert abs(points[1][1] - (-82.5)) < 0.01  # Lon should stay roughly same
    assert abs(points[1][2] - 0.5) < 0.01


def test_radial_points_east_west():
    """Radial at 90 deg (east) and 270 deg (west)."""
    from meshplanner.propagation.coverage import _radial_points

    east_points = _radial_points(35.6, -82.5, 90.0, max_range_km=1.0, step_km=0.5)
    west_points = _radial_points(35.6, -82.5, 270.0, max_range_km=1.0, step_km=0.5)

    # East: lon increases
    assert east_points[1][1] > -82.5
    # West: lon decreases
    assert west_points[1][1] < -82.5


def test_pixel_for_point():
    """Verify geographic->pixel conversion uses DEM affine."""
    from rasterio.transform import from_bounds

    from meshplanner.propagation.coverage import _pixel_for_point

    # 10x10 DEM from -82.6 to -82.4 lon, 35.5 to 35.7 lat
    affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)

    col, row = _pixel_for_point(35.6, -82.5, affine)
    # -82.5 is at 50% of longitude range = col 5
    # 35.6 is at 50% of latitude range = row 5
    assert col == 5, f"Expected col=5, got {col}"
    assert row == 5, f"Expected row=5, got {row}"


def test_radial_path_loss_basic():
    """End-to-end: compute path loss along one radial using synthetic DEM."""
    from rasterio.transform import from_bounds

    from meshplanner.propagation.coverage import _compute_radial_path_loss
    from meshplanner.propagation.params import LoraParams

    # 50x50 synthetic DEM with a hill
    dem = np.zeros((50, 50), dtype=np.float32)
    # Hill 10 rows south of center, 5 cols east
    hill_row, hill_col = 35, 30
    for r in range(hill_row - 3, hill_row + 4):
        for c in range(hill_col - 3, hill_col + 4):
            dist = ((r - hill_row) ** 2 + (c - hill_col) ** 2) ** 0.5
            dem[r, c] = max(0, 150 - dist * 30)

    affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 50, 50)
    tx_lat, tx_lon = 35.6, -82.5
    params = LoraParams(frequency_mhz=915.0, spreading_factor=10)

    results = _compute_radial_path_loss(
        dem, affine, tx_lat, tx_lon, 100.0,
        45.0, 5.0, 0.5, params,
    )

    assert len(results) > 0
    assert all("path_loss_db" in r for r in results)
    assert all("rssi_dbm" in r for r in results)
    # Path loss should increase with distance
    path_losses = [r["path_loss_db"] for r in results if r["distance_km"] > 0]
    assert all(
        path_losses[i] <= path_losses[i + 1]
        for i in range(len(path_losses) - 1)
    )


def test_coverage_at_threshold():
    """Binary coverage mask from RSSI raster."""
    from meshplanner.propagation.coverage import compute_coverage_at_threshold

    rssi = np.array([
        [-80, -90, -100],
        [-110, -120, -130],
        [-140, -150, -160],
    ], dtype=np.float32)

    mask = compute_coverage_at_threshold(rssi, -120.0)
    assert mask[0, 0]  # -80 >= -120
    assert not mask[2, 2]  # -160 < -120
    assert mask[1, 1]  # -120 == threshold, >= includes it
    assert mask.sum() == 5  # First 5 cells are >= -120


def test_coverage_area():
    """Coverage area calculation."""
    from rasterio.transform import from_bounds

    from meshplanner.propagation.coverage import compute_coverage_area

    mask = np.ones((10, 10), dtype=bool)  # 100% covered
    affine = from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)
    meta = {"affine": affine, "crs": "EPSG:4326"}

    area = compute_coverage_area(mask, meta)
    assert area > 0
    assert isinstance(area, float)
    assert area < 500  # 10x10 cells at ~1 km resolution ~= 100 km2


def test_estimate_coverage_raster_structure(tmp_path):
    """Verify compute_coverage_raster returns correct shapes and types."""
    from rasterio.transform import from_bounds

    from meshplanner.propagation.coverage import (
        _pixel_for_point,
        compute_coverage_raster,
    )

    # Small synthetic DEM (30x30, ~200m pixels)
    dem = np.zeros((30, 30), dtype=np.float32)
    dem[10:20, 10:20] = 50.0  # Small hill

    affine = from_bounds(-82.55, 35.55, -82.45, 35.65, 30, 30)
    meta = {"affine": affine, "crs": "EPSG:4326"}

    tx_lat, tx_lon = 35.60, -82.50  # Near center

    rssi, cov_meta = compute_coverage_raster(
        dem,
        meta,
        tx_lat,
        tx_lon,
        max_range_km=3.0,
        num_radials=36,  # 10 deg spacing for speed
        step_km=0.2,
        num_workers=4,
    )

    assert rssi.shape == dem.shape, f"Shape mismatch: {rssi.shape} vs {dem.shape}"
    assert rssi.dtype == np.float32
    assert cov_meta["tx_lat"] == tx_lat
    assert cov_meta["tx_lon"] == tx_lon
    assert cov_meta["type"] == "rssi"

    # Some pixels should have valid RSSI near TX
    tx_col, tx_row = _pixel_for_point(tx_lat, tx_lon, affine)
    near_tx = rssi[max(0, tx_row - 3): tx_row + 3, max(0, tx_col - 3): tx_col + 3]
    assert np.any(near_tx > -np.inf), "No RSSI values near TX"
    # Closer pixels should be better (higher RSSI)
    nearby_rssi = near_tx[near_tx > -np.inf]
    assert np.all(nearby_rssi > -150), f"RSSI too low: {nearby_rssi.min():.1f}"


def test_compute_coverage_raster_fast_path(tmp_path):
    """End-to-end coverage raster with minimal settings, fast execution."""
    from rasterio.transform import from_bounds

    from meshplanner.propagation.coverage import compute_coverage_raster
    from meshplanner.propagation.params import LoraParams

    # Tiny DEM (10x10, ~1 km pixels)
    dem = np.zeros((10, 10), dtype=np.float32)
    dem[4, 4] = 100.0  # Peak at center

    affine = from_bounds(-82.55, 35.55, -82.45, 35.65, 10, 10)
    meta = {"affine": affine, "crs": "EPSG:4326"}

    params = LoraParams(
        frequency_mhz=915.0, spreading_factor=10, tx_power_dbm=14
    )

    rssi, cov_meta = compute_coverage_raster(
        dem,
        meta,
        35.60,
        -82.50,
        params=params,
        max_range_km=2.0,
        num_radials=12,
        step_km=0.5,
        num_workers=2,
    )

    assert rssi.shape == (10, 10)
    assert rssi.dtype == np.float32
    assert np.any(np.isfinite(rssi))

    # At least compute something
    finite_count = np.sum(np.isfinite(rssi))
    assert finite_count > 0, "No valid RSSI values computed"
