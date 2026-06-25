#!/usr/bin/env python3
"""
Generate 10+ canonical terrain profiles for ITM cross-validation.

Each profile is saved as a YAML file with terrain elevations and metadata.
Expected loss ranges are computed using the Python ITM engine (itmlogic).

Usage:
    python tests/cross_validation/generate_profiles.py
"""

import math
import sys
import os
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import yaml
import numpy as np

from meshplanner.propagation.itm import compute_path_loss


PROFILES_DIR = Path(__file__).resolve().parent / "data" / "canonical"


def _make_elevations(
    num_points: int,
    base: float = 0.0,
    hill_center: int | None = None,
    hill_width: int = 10,
    hill_height: float = 0.0,
    valley_depth: float = 0.0,
    roughness_amplitude: float = 0.0,
    sea_level_to: int | None = None,
) -> list[float]:
    """Build a list of elevations for a terrain profile.

    Args:
        num_points: Total number of sample points.
        base: Base elevation (m).
        hill_center: Index of the ridge peak (None = no ridge).
        hill_width: Half-width of the ridge in sample points.
        hill_height: Ridge height above base (m).
        valley_depth: Valley depth below base at center (m).
        roughness_amplitude: Random roughness amplitude (m).
        sea_level_to: If set, first N points are sea level (0 m).

    Returns:
        List of elevation values.
    """
    elevs = [base] * num_points

    # Sea-level section
    if sea_level_to is not None:
        for i in range(min(sea_level_to, num_points)):
            elevs[i] = 0.0

    # Ridge / hill
    if hill_center is not None and hill_height > 0:
        for i in range(num_points):
            dist = abs(i - hill_center)
            if dist < hill_width:
                frac = math.cos(dist / hill_width * math.pi / 2)
                elevs[i] += hill_height * frac

    # Valley
    if valley_depth > 0:
        valley_center = num_points // 2
        for i in range(num_points):
            dist = abs(i - valley_center)
            if dist < hill_width * 2:
                frac = math.cos(dist / (hill_width * 2) * math.pi / 2)
                elevs[i] -= valley_depth * frac

    # Roughness
    if roughness_amplitude > 0:
        rng = np.random.RandomState(42)
        noise = rng.uniform(-roughness_amplitude, roughness_amplitude, num_points)
        # Apply roughness only to non-sea-level points
        for i in range(num_points):
            if sea_level_to is None or i >= sea_level_to:
                elevs[i] += float(noise[i])

    return [round(float(e), 1) for e in elevs]


# ---------------------------------------------------------------------------
# Profile definitions
# ---------------------------------------------------------------------------

PROFILES: list[dict] = []

# 1. Flat — 10 km completely flat terrain at sea level
p = dict(
    name="flat",
    terrain_type="flat",
    description="10 km completely flat terrain at sea level — baseline free-space test",
    num_points=101,
    total_distance_km=10.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.65, lon_end=-82.4),
)
p["elevations"] = _make_elevations(p["num_points"], base=0.0)
PROFILES.append(p)

# 2. Rolling Hills — 20 km with gentle undulations (20-50 m)
p = dict(
    name="rolling_hills",
    terrain_type="rolling_hills",
    description="20 km terrain with gentle rolling hills (20-50 m amplitude)",
    num_points=201,
    total_distance_km=20.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.68, lon_end=-82.3),
)
base = [10.0] * p["num_points"]
rng = np.random.RandomState(1)
for i in range(p["num_points"]):
    phase = 2 * math.pi * i / 30
    base[i] += 20 * math.sin(phase) + 10 * math.sin(2 * phase + 1) + rng.uniform(-3, 3)
p["elevations"] = [round(float(e), 1) for e in base]
PROFILES.append(p)

# 3. Single Ridge — 15 km with a prominent 150 m ridge in the middle
p = dict(
    name="single_ridge",
    terrain_type="single_ridge",
    description="15 km with a single prominent 150 m ridge at the midpoint",
    num_points=151,
    total_distance_km=15.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.66, lon_end=-82.35),
)
p["elevations"] = _make_elevations(
    p["num_points"], base=50.0, hill_center=75, hill_width=12, hill_height=150.0,
    roughness_amplitude=2.0,
)
PROFILES.append(p)

# 4. Deep Valley — 10 km starting high, dropping into valley, rising again
p = dict(
    name="deep_valley",
    terrain_type="deep_valley",
    description="10 km profile descending from 200 m into a deep valley at 50 m, then ascending to 150 m",
    num_points=101,
    total_distance_km=10.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.63, lon_end=-82.4),
)
elevs = []
for i in range(p["num_points"]):
    frac = i / (p["num_points"] - 1)
    # Parabolic valley: 200 -> 50 -> 150
    if frac < 0.4:
        e = 200 - (frac / 0.4) * 150
    elif frac < 0.7:
        e = 50 + ((frac - 0.4) / 0.3) * 100
    else:
        e = 150
    elevs.append(round(float(e) + float(rng.uniform(-2, 2)), 1))
p["elevations"] = elevs
PROFILES.append(p)

# 5. Mountain Ridge — 20 km with a 300 m+ mountain ridge
p = dict(
    name="mountain_ridge",
    terrain_type="mountain_ridge",
    description="20 km with a steep 350 m mountain ridge near the midpoint",
    num_points=201,
    total_distance_km=20.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.7, lon_end=-82.3),
)
p["elevations"] = _make_elevations(
    p["num_points"], base=100.0, hill_center=100, hill_width=20, hill_height=350.0,
    roughness_amplitude=5.0,
)
PROFILES.append(p)

# 6. Hill and Valley — 12 km alternating hill then valley
p = dict(
    name="hill_and_valley",
    terrain_type="hill_and_valley",
    description="12 km with a 120 m hill followed by a valley descending to 20 m",
    num_points=121,
    total_distance_km=12.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.64, lon_end=-82.38),
)
elevs = []
for i in range(p["num_points"]):
    frac = i / (p["num_points"] - 1)
    # Gaussian hill centered at 30%, valley at 65%
    hill = 120 * math.exp(-((frac - 0.3) ** 2) / (2 * 0.03**2))
    valley = -80 * math.exp(-((frac - 0.65) ** 2) / (2 * 0.04**2))
    e = 50 + hill + valley
    elevs.append(round(float(e) + float(rng.uniform(-1, 1)), 1))
p["elevations"] = elevs
PROFILES.append(p)

# 7. Double Ridge — 18 km with two distinct ridges (120 m and 200 m)
p = dict(
    name="double_ridge",
    terrain_type="double_ridge",
    description="18 km with two distinct ridges: 120 m at 30% and 200 m at 65%",
    num_points=181,
    total_distance_km=18.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.67, lon_end=-82.32),
)
elevs = _make_elevations(
    p["num_points"], base=30.0, roughness_amplitude=1.0,
)
# First ridge at 30% (idx ~54), 120 m
ridge1_center = int(0.30 * p["num_points"])
for i in range(p["num_points"]):
    dist = abs(i - ridge1_center)
    if dist < 10:
        elevs[i] += 120 * math.cos(dist / 10 * math.pi / 2)
# Second ridge at 65% (idx ~118), 200 m
ridge2_center = int(0.65 * p["num_points"])
for i in range(p["num_points"]):
    dist = abs(i - ridge2_center)
    if dist < 15:
        elevs[i] += 200 * math.cos(dist / 15 * math.pi / 2)
p["elevations"] = [round(float(e), 1) for e in elevs]
PROFILES.append(p)

# 8. Urban — 5 km with buildings modeled as terrain (10-50 m obstacles)
p = dict(
    name="urban",
    terrain_type="urban",
    description="5 km urban canyon with buildings modelled as terrain bumps (10-50 m)",
    num_points=101,
    total_distance_km=5.0,
    frequency_mhz=915.0,
    tx_height_m=15.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=5.0,
    ground_conductivity=0.001,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.6, lon_start=-82.5, lat_end=35.61, lon_end=-82.45),
)
rng = np.random.RandomState(99)
elevs = [0.0] * p["num_points"]
for i in range(p["num_points"]):
    # Street level at ~5 m, buildings as blocks
    base_e = 5.0
    frac = i / (p["num_points"] - 1)
    # 8 random building blocks
    for b in range(8):
        b_center = rng.rand()
        b_width = int(3 + rng.rand() * 5)
        b_height = 10 + rng.rand() * 40
        if abs(frac - b_center) < b_width / p["num_points"]:
            base_e += b_height
    elevs[i] = round(float(base_e) + float(rng.uniform(-1, 1)), 1)
p["elevations"] = elevs
PROFILES.append(p)

# 9. Coastal — 8 km from sea level rising to a 100 m hill
p = dict(
    name="coastal",
    terrain_type="coastal",
    description="8 km from sea level (coast) rising to a 100 m inland hill",
    num_points=81,
    total_distance_km=8.0,
    frequency_mhz=915.0,
    tx_height_m=10.0,
    rx_height_m=1.5,
    polarization=1,
    climate=6,
    ground_permittivity=20.0,
    ground_conductivity=0.005,
    surface_refractivity=350.0,
    endpoints=dict(lat_start=35.5, lon_start=-82.5, lat_end=35.55, lon_end=-82.42),
)
elevs = [0.0] * p["num_points"]
for i in range(p["num_points"]):
    frac = i / (p["num_points"] - 1)
    # Beach then gentle slope to 100 m hill
    if frac < 0.15:
        e = 0.0
    elif frac < 0.7:
        e = 100 * ((frac - 0.15) / 0.55) ** 1.5
    else:
        e = 100 * math.exp(-((frac - 0.75) ** 2) / (2 * 0.08**2))
    elevs[i] = round(float(e) + float(rng.uniform(-1, 1)), 1)
p["elevations"] = elevs
PROFILES.append(p)

# 10. Asheville Composite — realistic mountainous profile based on Asheville, NC
p = dict(
    name="asheville_composite",
    terrain_type="mountainous",
    description="Realistic 25 km profile simulating Asheville, NC mountainous terrain: "
    "river valley at 650 m rising to ridges at 1100 m+",
    num_points=251,
    total_distance_km=25.0,
    frequency_mhz=915.0,
    tx_height_m=15.0,
    rx_height_m=1.5,
    polarization=1,
    climate=5,
    ground_permittivity=15.0,
    ground_conductivity=0.005,
    surface_refractivity=314.0,
    endpoints=dict(lat_start=35.55, lon_start=-82.6, lat_end=35.7, lon_end=-82.4),
)
rng = np.random.RandomState(2024)
elevs = []
for i in range(p["num_points"]):
    frac = i / (p["num_points"] - 1)
    # Composite: valley at 650 m, ridges at 1100+ m, rolling terrain
    valley = 650 - 100 * math.exp(-((frac - 0.5) ** 2) / (2 * 0.1**2))
    ridge1 = 450 * math.exp(-((frac - 0.2) ** 2) / (2 * 0.06**2))
    ridge2 = 350 * math.exp(-((frac - 0.75) ** 2) / (2 * 0.05**2))
    slope = 50 * frac
    roughness = rng.uniform(-15, 15)
    e = valley + ridge1 + ridge2 + slope + roughness
    elevs.append(round(float(e), 1))
p["elevations"] = elevs
PROFILES.append(p)


def compute_expected_loss(
    elevations: list[float],
    total_distance_km: float,
    frequency_mhz: float = 915.0,
    tx_height_m: float = 10.0,
    rx_height_m: float = 1.5,
    polarization: int = 1,
    climate: int = 5,
    ground_permittivity: float = 15.0,
    ground_conductivity: float = 0.005,
    surface_refractivity: float = 314.0,
) -> dict:
    """Run the Python ITM engine and return expected loss values."""
    result = compute_path_loss(
        elevations=elevations,
        total_distance_km=total_distance_km,
        frequency_mhz=frequency_mhz,
        tx_height_m=tx_height_m,
        rx_height_m=rx_height_m,
        polarization=polarization,
        climate=climate,
        ground_permittivity=ground_permittivity,
        ground_conductivity=ground_conductivity,
        surface_refractivity=surface_refractivity,
    )
    return {
        "path_loss_db": float(result["path_loss_db"]),
        "path_loss_tolerance": 3.0,
        "free_space_loss_db": float(result["free_space_loss_db"]),
        "free_space_tolerance": 1.0,
        "excess_loss_db": float(result["excess_loss_db"]),
        "excess_loss_tolerance": 3.0,
    }


def main():
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    for profile in PROFILES:
        # Compute expected loss from Python ITM
        expected = compute_expected_loss(
            elevations=profile["elevations"],
            total_distance_km=profile["total_distance_km"],
            frequency_mhz=profile["frequency_mhz"],
            tx_height_m=profile["tx_height_m"],
            rx_height_m=profile["rx_height_m"],
            polarization=profile["polarization"],
            climate=profile["climate"],
            ground_permittivity=profile["ground_permittivity"],
            ground_conductivity=profile["ground_conductivity"],
            surface_refractivity=profile["surface_refractivity"],
        )

        # Build YAML document
        doc = {
            "canonical_terrain_profile": {
                "version": 1,
                "name": profile["name"],
                "terrain_type": profile["terrain_type"],
                "description": profile["description"],
                "endpoints": profile["endpoints"],
                "propagation_params": {
                    "total_distance_km": profile["total_distance_km"],
                    "frequency_mhz": profile["frequency_mhz"],
                    "tx_height_m": profile["tx_height_m"],
                    "rx_height_m": profile["rx_height_m"],
                    "polarization": profile["polarization"],
                    "climate": profile["climate"],
                    "ground_permittivity": profile["ground_permittivity"],
                    "ground_conductivity": profile["ground_conductivity"],
                    "surface_refractivity": profile["surface_refractivity"],
                },
                "expected_loss": expected,
                "elevations": profile["elevations"],
            }
        }

        filepath = PROFILES_DIR / f"{profile['name']}.yaml"
        with open(filepath, "w") as f:
            yaml.dump(doc, f, default_flow_style=None, sort_keys=False)

        pl = expected["path_loss_db"]
        fs = expected["free_space_loss_db"]
        ex = expected["excess_loss_db"]
        print(
            f"  {profile['name']:25s}  "
            f"PL={pl:6.1f} dB  FS={fs:6.1f} dB  EX={ex:6.1f} dB  "
            f"({len(profile['elevations']):3d} pts, {profile['total_distance_km']:5.1f} km)"
        )

    print(f"\n✅ {len(PROFILES)} profiles written to {PROFILES_DIR}")


if __name__ == "__main__":
    main()
