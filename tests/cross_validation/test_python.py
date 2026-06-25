"""Python ITM cross-validation tests with pytest-regressions golden data.

Loads each canonical terrain profile YAML, runs the Python ITM engine
(``compute_path_loss``), and checks that results match both:
  1. The golden data stored by ``pytest-regressions`` (for change detection).
  2. The ``expected_loss`` tolerance bounds in the profile YAML (for correctness).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from meshplanner.propagation.itm import compute_path_loss

PROFILES_DIR = Path(__file__).resolve().parent / "data" / "canonical"


def _load_profiles() -> list[dict]:
    """Return all canonical profile dicts sorted by name."""
    profile_files = sorted(PROFILES_DIR.glob("*.yaml"))
    profiles = []
    for pf in profile_files:
        with open(pf) as f:
            doc = yaml.safe_load(f)
        profiles.append(doc["canonical_terrain_profile"])
    return profiles


def _profile_id(profile: dict) -> str:
    """Test ID string used in parametrize()."""
    return profile["name"]


# ── Parametrize once over all 10+ profiles ────────────────────────────────


@pytest.fixture(
    params=_load_profiles(),
    ids=[_profile_id(p) for p in _load_profiles()],
)
def profile(request: pytest.FixtureRequest) -> dict:
    """Fixture yielding one canonical terrain profile at a time."""
    return request.param


class TestPythonItmGolden:
    """Golden-data regression tests for Python ITM."""

    def test_path_loss_matches_golden(
        self, profile: dict, data_regression
    ) -> None:
        """Run Python ITM on *profile* and check against golden data."""
        params = profile["propagation_params"]
        result = compute_path_loss(
            elevations=profile["elevations"],
            total_distance_km=params["total_distance_km"],
            frequency_mhz=params["frequency_mhz"],
            tx_height_m=params["tx_height_m"],
            rx_height_m=params["rx_height_m"],
            polarization=params["polarization"],
            climate=params["climate"],
            ground_permittivity=params["ground_permittivity"],
            ground_conductivity=params["ground_conductivity"],
            surface_refractivity=params["surface_refractivity"],
        )

        # pytest-regressions golden check
        data_regression.check(
            {
                "path_loss_db": float(result["path_loss_db"]),
                "free_space_loss_db": float(result["free_space_loss_db"]),
                "excess_loss_db": float(result["excess_loss_db"]),
                "distance_km": float(result["distance_km"]),
                "frequency_mhz": float(result["frequency_mhz"]),
                "profile": profile["name"],
            },
            basename=profile["name"],
        )

        # Also verify within expected_loss tolerance
        expected = profile["expected_loss"]
        pl_tol = expected["path_loss_tolerance"]
        assert abs(result["path_loss_db"] - expected["path_loss_db"]) <= pl_tol, (
            f"{profile['name']}: path_loss {result['path_loss_db']} "
            f"not within ±{pl_tol} of expected {expected['path_loss_db']}"
        )
        fs_tol = expected["free_space_tolerance"]
        fs_expected = expected["free_space_loss_db"]
        assert abs(result["free_space_loss_db"] - fs_expected) <= fs_tol, (
            f"{profile['name']}: free_space_loss {result['free_space_loss_db']} "
            f"not within ±{fs_tol} of expected {fs_expected}"
        )
        ex_tol = expected["excess_loss_tolerance"]
        ex_expected = expected["excess_loss_db"]
        assert abs(result["excess_loss_db"] - ex_expected) <= ex_tol, (
            f"{profile['name']}: excess_loss {result['excess_loss_db']} "
            f"not within ±{ex_tol} of expected {ex_expected}"
        )
