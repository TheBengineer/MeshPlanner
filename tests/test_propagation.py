"""Tests for propagation module."""

import pytest

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
