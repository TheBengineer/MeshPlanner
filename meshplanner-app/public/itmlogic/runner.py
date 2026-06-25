"""
Pyodide ITMLogic runner — loaded into Pyodide WASM to compute Longley-Rice
path loss in the browser.

This file mirrors the Python reference at
src/meshplanner/propagation/itm.py but is standalone so it can be
loaded into Pyodide via ``micropip`` + ``runPython`` without importing
the meshplanner package.

Exports:
    compute_path_loss_py(params: dict) -> dict

Usage (from JS via Pyodide):
    const result = pyodide.globals.get('compute_path_loss_py')({
        elevations: [...],
        total_distance_km: 10.0,
        frequency_mhz: 915.0,
        ...
    });
    // result is a JS object with path_loss_db, free_space_loss_db, etc.
"""

import math
from typing import Any, Dict, List

import numpy as np
from itmlogic.misc.qerfi import qerfi
from itmlogic.preparatory_subroutines.qlrpfl import qlrpfl
from itmlogic.statistics.avar import avar


# ---------------------------------------------------------------------------
# Climate constants  (itmlogic codes 1-7)
# ---------------------------------------------------------------------------

CLIMATES: Dict[str, int] = {
    "equatorial": 1,
    "continental_subtropical": 2,
    "maritime_subtropical": 3,
    "desert": 4,
    "continental_temperate": 5,
    "maritime_temperate_overland": 6,
    "maritime_temperate_oversea": 7,
}

# Default environmental constants (continental temperate)
DEFAULT_EPS: float = 15.0  # Relative permittivity of ground
DEFAULT_SGM: float = 0.005  # Ground conductivity (S/m)
DEFAULT_ENS0: float = 314.0  # Surface refractivity (N-units)


# ---------------------------------------------------------------------------
# Internal helpers (mirrors _build_prop in src/meshplanner/propagation/itm.py)
# ---------------------------------------------------------------------------


def _build_prop(
    elevations: List[float],
    total_distance_km: float,
    frequency_mhz: float = 915.0,
    tx_height_m: float = 10.0,
    rx_height_m: float = 1.5,
    polarization: int = 1,
    climate: int = 5,
    eps: float = DEFAULT_EPS,
    sgm: float = DEFAULT_SGM,
    ens0: float = DEFAULT_ENS0,
) -> dict:
    """Build and initialise the ``prop`` dictionary expected by itmlogic.

    Parameters
    ----------
    elevations : list of float
        Terrain elevation values (metres) at evenly spaced sample points
        along the great-circle path.
    total_distance_km : float
        Total path length in kilometres.
    frequency_mhz : float
        Frequency in MHz.
    tx_height_m : float
        Height of the transmitting antenna above ground (m).
    rx_height_m : float
        Height of the receiving antenna above ground (m).
    polarization : int
        0 = horizontal, 1 = vertical.
    climate : int
        Climate code 1-7.
    eps : float
        Ground dielectric constant (relative permittivity).
    sgm : float
        Ground conductivity (S/m).
    ens0 : float
        Surface refractivity (N-units).

    Returns
    -------
    dict
        Fully populated ``prop`` dict ready to pass to :func:`qlrpfl`.
    """
    num_points = len(elevations)
    num_segments = num_points - 1

    if num_segments <= 0:
        raise ValueError(
            f"Elevation profile must have at least 2 points, got {num_points}"
        )

    delta_distance_m = (total_distance_km * 1000.0) / num_segments

    # Terrain profile list: [num_segments, step_m, elev_0, ..., elev_N]
    pfl: list = [num_segments, delta_distance_m] + [float(e) for e in elevations]

    prop: Dict[str, Any] = {
        "pfl": pfl,
        "hg": [tx_height_m, rx_height_m],
        "fmhz": frequency_mhz,
        "d": total_distance_km,
        "ipol": polarization,
        "eps": eps,
        "sgm": sgm,
        "klim": climate,
        "ens0": ens0,
    }

    # --- Derived parameters required by itmlogic internals ---

    prop["kwx"] = 0
    prop["wn"] = prop["fmhz"] / 47.7  # wavenumber in radians/metre
    prop["ens"] = prop["ens0"]

    # Effective Earth curvature (accounts for atmospheric refraction)
    gma = 157e-9
    prop["gme"] = gma * (1 - 0.04665 * math.exp(prop["ens"] / 179.3))

    # Complex ground impedance
    zq = complex(prop["eps"], 376.62 * prop["sgm"] / prop["wn"])
    prop["zgnd"] = np.sqrt(zq - 1)
    if prop["ipol"] != 0:
        prop["zgnd"] = prop["zgnd"] / zq

    # Variability mode flags
    prop["klimx"] = 0  # keep the climate code passed by the user
    prop["mdvarx"] = 11  # broadcast / individual mode
    prop["lvar"] = 5  # request full variability calculation

    return prop


def _run_itm(prop: dict) -> dict:
    """Run the ITM point-to-point engine on *prop*.

    Thin wrapper around ``qlrpfl`` (which internally calls ``lrprop``).
    """
    return qlrpfl(prop)


# ---------------------------------------------------------------------------
# Public compute function (callable from JS via Pyodide bridge)
# ---------------------------------------------------------------------------


def compute_path_loss_py(params: dict) -> dict:
    """Compute ITM median path loss for a single terrain profile.

    Parameters are passed as a single dict (automatically converted from
    JS object by the Pyodide bridge):

        elevations : list[float]  (required)
        total_distance_km : float  (required)
        frequency_mhz : float  (default 915.0)
        tx_height_m : float  (default 10.0)
        rx_height_m : float  (default 1.5)
        polarization : int  (default 1)
        climate : int  (default 5)
        ground_permittivity : float  (default 15.0)
        ground_conductivity : float  (default 0.005)
        surface_refractivity : float  (default 314.0)
        time_availability : float  (default 0.5)
        location_availability : float  (default 0.5)
        confidence : float  (default 0.5)

    Returns
    -------
    dict with keys:
        path_loss_db : float
        free_space_loss_db : float
        excess_loss_db : float
        frequency_mhz : float
        distance_km : float
        tx_height_m : float
        rx_height_m : float
        climate : int
        polarization : int
    """
    elevations: List[float] = list(params["elevations"])
    total_distance_km: float = float(params["total_distance_km"])
    frequency_mhz: float = float(params.get("frequency_mhz", 915.0))
    tx_height_m: float = float(params.get("tx_height_m", 10.0))
    rx_height_m: float = float(params.get("rx_height_m", 1.5))
    polarization: int = int(params.get("polarization", 1))
    climate: int = int(params.get("climate", 5))
    ground_permittivity: float = float(params.get("ground_permittivity", DEFAULT_EPS))
    ground_conductivity: float = float(params.get("ground_conductivity", DEFAULT_SGM))
    surface_refractivity: float = float(params.get("surface_refractivity", DEFAULT_ENS0))
    time_availability: float = float(params.get("time_availability", 0.5))
    location_availability: float = float(params.get("location_availability", 0.5))
    confidence: float = float(params.get("confidence", 0.5))

    prop = _build_prop(
        elevations=elevations,
        total_distance_km=total_distance_km,
        frequency_mhz=frequency_mhz,
        tx_height_m=tx_height_m,
        rx_height_m=rx_height_m,
        polarization=polarization,
        climate=climate,
        eps=ground_permittivity,
        sgm=ground_conductivity,
        ens0=surface_refractivity,
    )

    # Free-space path loss (ITU-R P.525) — compute before ITM engine
    if total_distance_km > 0:
        fs_db = (
            32.45
            + 20 * math.log10(frequency_mhz)
            + 20 * math.log10(total_distance_km)
        )
    else:
        # Degenerate case: return free-space = 0 dB
        return {
            "path_loss_db": 0.0,
            "free_space_loss_db": 0.0,
            "excess_loss_db": 0.0,
            "frequency_mhz": frequency_mhz,
            "distance_km": total_distance_km,
            "tx_height_m": tx_height_m,
            "rx_height_m": rx_height_m,
            "climate": climate,
            "polarization": polarization,
        }

    # Run the ITM engine
    prop = _run_itm(prop)

    # Convert the time / location / confidence quantiles to z-scores
    zt = qerfi([time_availability])[0]
    zl = qerfi([location_availability])[0]
    zc = qerfi([confidence])[0]

    excess_db, _ = avar(zt, zl, zc, prop)

    total_db = fs_db + excess_db

    return {
        "path_loss_db": round(total_db, 1),
        "free_space_loss_db": round(fs_db, 1),
        "excess_loss_db": round(excess_db, 1),
        "frequency_mhz": frequency_mhz,
        "distance_km": total_distance_km,
        "tx_height_m": tx_height_m,
        "rx_height_m": rx_height_m,
        "climate": climate,
        "polarization": polarization,
    }


# ---------------------------------------------------------------------------
# CLI entry point — validates that runner.py works as a standalone script
# Usage: echo '<json_params>' | python3 runner.py
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    import sys

    input_str = sys.stdin.read()
    params = json.loads(input_str)
    output = compute_path_loss_py(params)
    json.dump(output, sys.stdout)
    print()  # trailing newline
