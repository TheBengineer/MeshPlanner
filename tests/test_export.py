"""Tests for GeoTIFF export module."""
import numpy as np
from pathlib import Path


def mock_affine():
    """Create a mock affine transform for testing."""
    from rasterio.transform import from_bounds

    return from_bounds(-82.6, 35.5, -82.4, 35.7, 10, 10)


class TestExport:
    """Tests for GeoTIFF export module."""

    def test_export_rssi_geotiff(self, tmp_path):
        """Export RSSI raster as GeoTIFF and verify file exists."""
        from meshplanner.export.raster import export_geotiff

        rssi = np.random.uniform(-140, -60, (20, 20)).astype(np.float32)
        meta = {
            "dem_affine": mock_affine(),
            "tx_lat": 35.6,
            "tx_lon": -82.5,
            "params": {"frequency_mhz": 915, "spreading_factor": 10, "tx_power_dbm": 20},
        }

        out_path = tmp_path / "rssi.tif"
        result = export_geotiff(rssi, meta, str(out_path))

        assert Path(result).exists()
        assert result.endswith(".tif")

    def test_export_rssi_with_threshold(self, tmp_path):
        """Export with threshold masking."""
        from meshplanner.export.raster import export_geotiff

        rssi = np.full((10, 10), -130.0, dtype=np.float32)
        rssi[0, 0] = -80.0
        rssi[5, 5] = -150.0
        meta = {"dem_affine": mock_affine(), "tx_lat": 35.6, "tx_lon": -82.5, "params": {}}

        out_path = tmp_path / "rssi_thresh.tif"
        export_geotiff(rssi, meta, str(out_path), threshold=-120.0)

        import rasterio

        with rasterio.open(str(out_path)) as src:
            data = src.read(1)
            assert data[0, 0] == -80.0  # Above threshold, preserved
            assert data[5, 5] == -9999.0  # Below threshold, nodata

    def test_export_coverage_mask(self, tmp_path):
        """Export boolean coverage mask as GeoTIFF."""
        from meshplanner.export.raster import export_coverage_mask

        mask = np.zeros((15, 15), dtype=bool)
        mask[2:8, 3:10] = True
        meta = {"dem_affine": mock_affine(), "tx_lat": 35.6, "tx_lon": -82.5}

        out_path = tmp_path / "mask.tif"
        export_coverage_mask(mask, meta, str(out_path))

        import rasterio

        with rasterio.open(str(out_path)) as src:
            data = src.read(1)
            assert data.dtype == rasterio.uint8
            assert data[5, 5] == 255  # Covered
            assert data[0, 0] == 0  # Not covered

    def test_export_both(self, tmp_path):
        """Export both RSSI and mask GeoTIFFs."""
        from meshplanner.export.raster import export_both

        rssi = np.full((10, 10), -130.0, dtype=np.float32)
        rssi[0, 0] = -80.0
        meta = {"dem_affine": mock_affine(), "tx_lat": 35.6, "tx_lon": -82.5, "params": {}}

        stem = str(tmp_path / "coverage")
        result = export_both(rssi, meta, stem, threshold=-120.0)

        assert Path(result["rssi_path"]).exists()
        assert Path(result["mask_path"]).exists()
        assert "rssi" in result["rssi_path"]
        assert "mask" in result["mask_path"]

    def test_export_geotiff_opens_in_gdal(self, tmp_path):
        """Verify GeoTIFF has correct geospatial metadata."""
        from meshplanner.export.raster import export_geotiff

        rssi = np.zeros((10, 10), dtype=np.float32)
        meta = {
            "dem_affine": mock_affine(),
            "tx_lat": 35.6,
            "tx_lon": -82.5,
            "params": {"frequency_mhz": 915, "spreading_factor": 10, "tx_power_dbm": 20},
            "max_range_km": 5.0,
            "num_radials": 36,
        }

        out_path = tmp_path / "gdal_check.tif"
        export_geotiff(rssi, meta, str(out_path))

        import rasterio

        with rasterio.open(str(out_path)) as src:
            assert src.crs.to_string() == "EPSG:4326"
            assert src.count == 1
            assert src.profile["compress"] == "deflate"
            assert "RSSI_COVERAGE" in src.tags().get("TYPE", "")
