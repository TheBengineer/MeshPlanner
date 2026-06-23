"""ITM (Irregular Terrain Model) propagation wrapper using itmlogic.

Provides terrain-aware path loss computation via the Longley-Rice ITM model,
implemented by the pure-Python ``itmlogic`` library (v1.2+).

Usage
-----
>>> from meshplanner.propagation.itm import compute_path_loss
>>> result = compute_path_loss(
...     elevations=[0.0] * 100,
...     total_distance_km=10.0,
...     frequency_mhz=915.0,
... )
>>> result["path_loss_db"]
138.2
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
# Internal helpers
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
        Climate code 1-7 (see :data:`CLIMATES`).
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

    This is a thin wrapper around ``qlrpfl`` (which internally calls
    ``lrprop``).  The returned dict contains the reference attenuation
    and all intermediate terms needed by ``avar``.
    """
    return qlrpfl(prop)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_path_loss(
    elevations: List[float],
    total_distance_km: float,
    frequency_mhz: float = 915.0,
    tx_height_m: float = 10.0,
    rx_height_m: float = 1.5,
    polarization: int = 1,
    climate: int = 5,
    ground_permittivity: float = DEFAULT_EPS,
    ground_conductivity: float = DEFAULT_SGM,
    surface_refractivity: float = DEFAULT_ENS0,
    time_availability: float = 0.5,
    location_availability: float = 0.5,
    confidence: float = 0.5,
) -> dict:
    """Compute ITM median path loss for a single terrain profile.

    Parameters
    ----------
    elevations : list of float
        Evenly-spaced terrain elevations (m) along the great-circle path.
    total_distance_km : float
        Path length in km.
    frequency_mhz : float
        Centre frequency (MHz).  Default 915.0 (US915 ISM band).
    tx_height_m : float
        Transmitter antenna height above ground (m).  Default 10.0.
    rx_height_m : float
        Receiver antenna height above ground (m).  Default 1.5.
    polarization : int
        0 = horizontal, 1 = vertical.  Default 1.
    climate : int
        ITM climate code (1-7).  Default 5 (continental temperate).
    ground_permittivity : float
        Relative permittivity of the ground.  Default 15.0.
    ground_conductivity : float
        Ground conductivity (S/m).  Default 0.005.
    surface_refractivity : float
        Surface refractivity (N-units).  Default 314.0.
    time_availability : float
        Time availability quantile (0-1).  Default 0.5 (median).
    location_availability : float
        Location availability quantile (0-1).  Default 0.5 (median).
    confidence : float
        Confidence quantile (0-1).  Default 0.5 (median).

    Returns
    -------
    dict
        ``path_loss_db`` : total median path loss (dB) *[rounded to 1 dp]* \\
        ``free_space_loss_db`` : free-space path loss (dB) *[rounded]* \\
        ``excess_loss_db`` : ITM excess loss above free space (dB) *[rounded]* \\
        ``frequency_mhz``, ``distance_km``, ``tx_height_m``, ``rx_height_m``, \\
        ``climate``, ``polarization``
    """
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
        fs_db = 32.45 + 20 * math.log10(frequency_mhz) + 20 * math.log10(total_distance_km)
    else:
        # Degenerate case: the ITM engine cannot handle zero distance
        # (internally divides by distance).  Return free-space = 0 dB.
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


def path_loss_at_fraction(
    elevations: List[float],
    total_distance_km: float,
    fraction: float = 0.5,
    **kwargs,
) -> float:
    """Compute path loss at a specific cumulative quantile.

    This is a convenience wrapper around :func:`compute_path_loss` that
    varies the **time availability** quantile while holding location and
    confidence at their medians.

    Parameters
    ----------
    elevations : list of float
        Evenly-spaced terrain elevations (m) along the path.
    total_distance_km : float
        Path length in km.
    fraction : float
        Quantile in **[0, 1]**; 0.5 = median, 0.9 = 90th percentile
        (loss that is not exceeded 90 % of the time).
    **kwargs
        Additional keyword arguments forwarded to
        :func:`compute_path_loss` (e.g. ``frequency_mhz``).

    Returns
    -------
    float
        Path loss in dB at the requested quantile.
    """
    # Convert probability to z-score via the inverse normal
    zt = qerfi([fraction])[0]

    # Build prop dict and run ITM
    prop = _build_prop(
        elevations=elevations,
        total_distance_km=total_distance_km,
        frequency_mhz=kwargs.get("frequency_mhz", 915.0),
        tx_height_m=kwargs.get("tx_height_m", 10.0),
        rx_height_m=kwargs.get("rx_height_m", 1.5),
        polarization=kwargs.get("polarization", 1),
        climate=kwargs.get("climate", 5),
        eps=kwargs.get("ground_permittivity", DEFAULT_EPS),
        sgm=kwargs.get("ground_conductivity", DEFAULT_SGM),
        ens0=kwargs.get("surface_refractivity", DEFAULT_ENS0),
    )

    prop = _run_itm(prop)

    if total_distance_km > 0:
        fs_db = 32.45 + 20 * math.log10(prop["fmhz"]) + 20 * math.log10(total_distance_km)
    else:
        fs_db = 0.0

    excess_db, _ = avar(zt, 0.0, 0.0, prop)

    return round(fs_db + excess_db, 1)


def estimate_loss_from_profile(
    profile: dict,
    frequency_mhz: float = 915.0,
    tx_height_m: float = 10.0,
    rx_height_m: float = 1.5,
) -> dict:
    """Convenience wrapper that accepts a profile dict.

    The dict is expected to have at least the keys ``"elevations"`` (list
    of float) and ``"total_distance_km"`` (float), as produced by the
    ``profile.py`` extraction module.

    Parameters
    ----------
    profile : dict
        Profile dictionary with ``elevations`` and ``total_distance_km``.
    frequency_mhz : float
        Centre frequency (MHz).  Default 915.0.
    tx_height_m : float
        Transmitter height above ground (m).  Default 10.0.
    rx_height_m : float
        Receiver height above ground (m).  Default 1.5.

    Returns
    -------
    dict
        Same as :func:`compute_path_loss`.
    """
    return compute_path_loss(
        elevations=profile["elevations"],
        total_distance_km=profile["total_distance_km"],
        frequency_mhz=frequency_mhz,
        tx_height_m=tx_height_m,
        rx_height_m=rx_height_m,
    )
