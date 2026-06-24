"""Batch processing of multiple candidate sites for coverage analysis.

Provides parallel computation of coverage rasters across a list of
candidate sites with progress reporting and per-site timing.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

import numpy as np
from tqdm import tqdm

from meshplanner.propagation.coverage import compute_coverage_raster
from meshplanner.propagation.params import LoraParams
from meshplanner.sites.candidate import CandidateSite

logger = logging.getLogger(__name__)


def process_sites(
    dem_array: np.ndarray,
    dem_metadata: dict,
    sites: List[CandidateSite],
    params: Optional[LoraParams] = None,
    max_range_km: float = 30.0,
    num_radials: int = 360,
    step_km: float = 0.1,
    num_workers: int = 4,
    show_progress: bool = True,
) -> Dict[str, Tuple[np.ndarray, dict]]:
    """Process multiple candidate sites in parallel, computing coverage rasters.

    Iterates over the provided sites, computing an RSSI coverage raster for
    each using ITM propagation along radials.  Sites are distributed across a
    thread pool for parallelism.  Progress is reported via *tqdm* when
    ``show_progress`` is ``True``.

    If a site fails (e.g. invalid location, all-radial failure), a warning is
    logged and processing continues with the remaining sites.

    Args:
        dem_array: 2-D elevation array (meters) from ``fetch_dem_raster()``.
        dem_metadata: DEM metadata dict.  Must contain an ``"affine"`` key
            with a ``rasterio.Affine`` transform mapping ``(col, row)`` to
            ``(lon, lat)`` in ``EPSG:4326``.
        sites: List of candidate sites to process.
        params: LoRa link parameters.  Defaults to
            ``LoraParams()`` (US915, SF10, 20 dBm).
        max_range_km: Maximum analysis range from each transmitter (km).
        num_radials: Number of evenly-spaced radials (default 360 ≈ 1°).
        step_km: Distance between sample points along each radial (km).
        num_workers: Maximum number of parallel workers for site-level
            processing.
        show_progress: If ``True``, display a ``tqdm`` progress bar with
            site names and per-site elapsed time.

    Returns:
        Dict mapping each **successful** site name (``str``) to a
        ``(rssi_raster, coverage_metadata)`` tuple:

        - ``rssi_raster``: 2-D ``numpy.ndarray`` (``float32``) of RSSI values
          in dBm, same shape as ``dem_array``.  Unreachable cells are
          ``-inf``.
        - ``coverage_metadata``: Dict with computation parameters, site
          info, and elapsed time.

        An empty dict is returned when **all** sites fail.

    Example:
        >>> results = process_sites(
        ...     dem_array, dem_metadata,
        ...     sites=[site_a, site_b],
        ...     params=LoraParams(spreading_factor=12),
        ... )
        >>> for name, (rssi, meta) in results.items():
        ...     print(f"{name}: {meta['elapsed_s']}s")
    """
    if params is None:
        params = LoraParams()

    if not sites:
        logger.warning("process_sites called with empty sites list")
        return {}

    results: Dict[str, Tuple[np.ndarray, dict]] = {}
    total_start = time.time()
    site_times: Dict[str, float] = {}

    # ── Outer progress bar ──────────────────────────────────────────────
    site_iterable = tqdm(
        sites,
        desc="Processing sites",
        unit="site",
        disable=not show_progress,
    )

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures: dict = {}
        for site in sites:
            future = executor.submit(
                _process_single_site,
                dem_array,
                dem_metadata,
                site,
                params,
                max_range_km,
                num_radials,
                step_km,
            )
            futures[future] = site

        for future in as_completed(futures):
            site = futures[future]
            try:
                rssi_raster, coverage_metadata, elapsed = future.result()
                results[site.name] = (rssi_raster, coverage_metadata)
                site_times[site.name] = elapsed
                if show_progress:
                    site_iterable.set_description(
                        f"Completed {site.name} ({elapsed:.1f}s)"
                    )
            except Exception as exc:
                logger.warning("Skipping site '%s': %s", site.name, exc)
                if show_progress:
                    site_iterable.set_description(f"Failed {site.name}")
            finally:
                site_iterable.update(1)

    elapsed_total = time.time() - total_start

    # ── Summary ────────────────────────────────────────────────────────
    if show_progress:
        tqdm.write("─" * 50)
        tqdm.write(
            f"Batch complete: {elapsed_total:.1f}s total  "
            f"({len(results)}/{len(sites)} sites succeeded)"
        )
        for site_name, t in sorted(site_times.items(), key=lambda x: -x[1]):
            tqdm.write(f"  {site_name:<30s} {t:>7.1f}s")
        if len(results) < len(sites):
            failed = [s.name for s in sites if s.name not in results]
            tqdm.write(f"Failed: {', '.join(failed)}")

    return results


# ── Internal helpers ─────────────────────────────────────────────────────


def _process_single_site(
    dem_array: np.ndarray,
    dem_metadata: dict,
    site: CandidateSite,
    params: LoraParams,
    max_range_km: float,
    num_radials: int,
    step_km: float,
) -> Tuple[np.ndarray, dict, float]:
    """Compute coverage for one site and return (raster, metadata, elapsed_s)."""
    site_start = time.time()

    rssi_raster, coverage_metadata = compute_coverage_raster(
        dem_array=dem_array,
        dem_metadata=dem_metadata,
        tx_lat=site.latitude,
        tx_lon=site.longitude,
        params=params,
        max_range_km=max_range_km,
        num_radials=num_radials,
        step_km=step_km,
    )

    elapsed = time.time() - site_start

    # Augment metadata with site-specific information
    coverage_metadata["site_name"] = site.name
    coverage_metadata["site_lat"] = site.latitude
    coverage_metadata["site_lon"] = site.longitude
    coverage_metadata["elapsed_s"] = round(elapsed, 2)

    return rssi_raster, coverage_metadata, elapsed
