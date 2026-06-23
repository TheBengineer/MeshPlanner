"""GeoTIFF export for coverage rasters."""
import numpy as np
from pathlib import Path
from typing import Optional

import rasterio


def export_geotiff(
    rssi_raster: np.ndarray,
    coverage_metadata: dict,
    output_path: str,
    threshold: Optional[float] = None,
) -> str:
    """Write RSSI raster as a GeoTIFF file.

    Args:
        rssi_raster: 2D numpy array of RSSI values (dBm), from compute_coverage_raster()
        coverage_metadata: Metadata dict from compute_coverage_raster()
        output_path: Path for the output .tif file
        threshold: If set, pixels with RSSI < threshold are set to nodata

    Returns:
        Path to the written file (as string)
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    affine = coverage_metadata.get("dem_affine", coverage_metadata.get("affine"))

    data = rssi_raster.copy()

    # Apply threshold masking if specified
    nodata = -9999.0
    if threshold is not None:
        data[data < threshold] = nodata
    else:
        # Mark infinite/no-data pixels
        data[~np.isfinite(data)] = nodata

    # Convert to float32 for GeoTIFF
    data = data.astype(np.float32)

    profile = {
        "driver": "GTiff",
        "height": data.shape[0],
        "width": data.shape[1],
        "count": 1,
        "dtype": rasterio.float32,
        "crs": "EPSG:4326",
        "transform": affine,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "nodata": nodata,
    }

    with rasterio.open(str(output_path), "w", **profile) as dst:
        dst.write(data, 1)
        dst.update_tags(
            TYPE="RSSI_COVERAGE",
            UNITS="dBm",
            TX_LAT=str(coverage_metadata.get("tx_lat", "")),
            TX_LON=str(coverage_metadata.get("tx_lon", "")),
            FREQUENCY_MHZ=str(
                coverage_metadata.get("params", {}).get("frequency_mhz", "")
            ),
            SF=str(
                coverage_metadata.get("params", {}).get("spreading_factor", "")
            ),
            TX_POWER_DBM=str(
                coverage_metadata.get("params", {}).get("tx_power_dbm", "")
            ),
            MAX_RANGE_KM=str(coverage_metadata.get("max_range_km", "")),
            NUM_RADIALS=str(coverage_metadata.get("num_radials", "")),
        )

    return str(output_path)


def export_coverage_mask(
    mask: np.ndarray,
    coverage_metadata: dict,
    output_path: str,
) -> str:
    """Write binary coverage mask as a GeoTIFF file.

    Args:
        mask: Boolean array from compute_coverage_at_threshold()
        coverage_metadata: Metadata dict
        output_path: Path for the output .tif file

    Returns:
        Path to the written file
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    affine = coverage_metadata.get("dem_affine", coverage_metadata.get("affine"))

    # Convert boolean to uint8: 1=covered, 0=not covered
    data = mask.astype(rasterio.uint8) * 255

    profile = {
        "driver": "GTiff",
        "height": data.shape[0],
        "width": data.shape[1],
        "count": 1,
        "dtype": rasterio.uint8,
        "crs": "EPSG:4326",
        "transform": affine,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "nodata": 0,
    }

    with rasterio.open(str(output_path), "w", **profile) as dst:
        dst.write(data, 1)
        dst.update_tags(
            TYPE="COVERAGE_MASK",
            COVERED="255",
            NOT_COVERED="0",
            TX_LAT=str(coverage_metadata.get("tx_lat", "")),
            TX_LON=str(coverage_metadata.get("tx_lon", "")),
        )

    return str(output_path)


def export_both(
    rssi_raster: np.ndarray,
    coverage_metadata: dict,
    output_path_stem: str,
    threshold: float = -120.0,
) -> dict:
    """Export both RSSI raster and coverage mask as GeoTIFFs.

    Args:
        rssi_raster: RSSI array from compute_coverage_raster()
        coverage_metadata: Metadata dict
        output_path_stem: Output path WITHOUT extension (e.g., "outputs/coverage")
        threshold: RSSI threshold for coverage mask (default -120 dBm for SF10)

    Returns:
        dict with keys: "rssi_path", "mask_path"
    """
    rssi_path = export_geotiff(
        rssi_raster, coverage_metadata, f"{output_path_stem}_rssi.tif"
    )

    from meshplanner.propagation.coverage import compute_coverage_at_threshold

    mask = compute_coverage_at_threshold(rssi_raster, threshold)
    mask_path = export_coverage_mask(
        mask, coverage_metadata, f"{output_path_stem}_mask.tif"
    )

    return {"rssi_path": rssi_path, "mask_path": mask_path}
