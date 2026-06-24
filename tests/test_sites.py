"""Tests for sites module — CandidateSite dataclass and CSV/GeoJSON I/O."""

import json
import os
import tempfile

import pytest

from meshplanner.sites import (
    CandidateSite,
    read_sites_csv,
    read_sites_geojson,
    write_sites_csv,
    write_sites_geojson,
)

# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def sample_sites() -> list[CandidateSite]:
    return [
        CandidateSite(name="Hilltop A", latitude=35.5, longitude=-82.5, elevation_m=800.0),
        CandidateSite(name="Fire Station 1", latitude=35.52, longitude=-82.48, notes="Main station"),
        CandidateSite(name="School", latitude=35.48, longitude=-82.52),
    ]


# ── CandidateSite validation ────────────────────────────────────────────────


class TestCandidateSite:
    def test_basic_creation(self):
        site = CandidateSite(name="Test Site", latitude=35.0, longitude=-82.0)
        assert site.name == "Test Site"
        assert site.latitude == 35.0
        assert site.longitude == -82.0
        assert site.elevation_m is None
        assert site.notes is None

    def test_with_all_fields(self):
        site = CandidateSite(
            name="Full Site", latitude=35.0, longitude=-82.0,
            elevation_m=500.5, notes="Some note",
        )
        assert site.name == "Full Site"
        assert site.elevation_m == 500.5
        assert site.notes == "Some note"

    def test_invalid_name_empty(self):
        with pytest.raises(ValueError, match="Invalid site name"):
            CandidateSite(name="", latitude=35.0, longitude=-82.0)

    def test_invalid_latitude_too_low(self):
        with pytest.raises(ValueError, match="out of range"):
            CandidateSite(name="Bad", latitude=-91.0, longitude=0)

    def test_invalid_latitude_too_high(self):
        with pytest.raises(ValueError, match="out of range"):
            CandidateSite(name="Bad", latitude=91.0, longitude=0)

    def test_invalid_longitude_too_low(self):
        with pytest.raises(ValueError, match="out of range"):
            CandidateSite(name="Bad", latitude=0, longitude=-181.0)

    def test_invalid_longitude_too_high(self):
        with pytest.raises(ValueError, match="out of range"):
            CandidateSite(name="Bad", latitude=0, longitude=181.0)

    def test_string_coords_are_coerced(self):
        """CandidateSite accepts string lat/lon, __post_init__ converts to float."""
        site = CandidateSite(name="Coercion", latitude="35.5", longitude="-82.5")
        assert isinstance(site.latitude, float)
        assert isinstance(site.longitude, float)
        assert site.latitude == 35.5
        assert site.longitude == -82.5

    def test_equality(self):
        s1 = CandidateSite(name="A", latitude=35.0, longitude=-82.0)
        s2 = CandidateSite(name="A", latitude=35.0, longitude=-82.0)
        assert s1 == s2

    def test_repr(self):
        site = CandidateSite(name="R", latitude=35.0, longitude=-82.0)
        r = repr(site)
        assert "R" in r
        assert "35.0" in r
        # notes should not appear in repr by default
        assert "notes" not in r


# ── CSV round-trip ──────────────────────────────────────────────────────────


class TestCsvRoundTrip:
    def test_round_trip(self, sample_sites):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, newline=""
        ) as f:
            csv_path = f.name

        try:
            write_sites_csv(sample_sites, csv_path)
            reloaded = read_sites_csv(csv_path)

            assert len(reloaded) == len(sample_sites)
            for orig, new in zip(sample_sites, reloaded):
                assert orig == new
        finally:
            os.unlink(csv_path)

    def test_round_trip_empty(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, newline=""
        ) as f:
            csv_path = f.name

        try:
            write_sites_csv([], csv_path)
            reloaded = read_sites_csv(csv_path)
            assert reloaded == []
        finally:
            os.unlink(csv_path)

    def test_round_trip_with_nulls(self):
        """Sites with None elevation/notes round-trip correctly."""
        sites = [
            CandidateSite(name="NoElev", latitude=35.0, longitude=-82.0),
            CandidateSite(name="WithElev", latitude=35.1, longitude=-82.1, elevation_m=100.0),
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, newline=""
        ) as f:
            csv_path = f.name

        try:
            write_sites_csv(sites, csv_path)
            reloaded = read_sites_csv(csv_path)
            assert reloaded[0].elevation_m is None
            assert reloaded[1].elevation_m == 100.0
            assert reloaded[0].notes is None
        finally:
            os.unlink(csv_path)


# ── CSV edge cases ──────────────────────────────────────────────────────────


class TestCsvEdgeCases:
    def test_empty_file_returns_empty_list(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("")  # no content at all

        try:
            result = read_sites_csv(csv_path)
            assert result == []
        finally:
            os.unlink(csv_path)

    def test_header_only_file_returns_empty_list(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon\n")

        try:
            result = read_sites_csv(csv_path)
            assert result == []
        finally:
            os.unlink(csv_path)

    def test_missing_required_column(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat\n")

        try:
            with pytest.raises(ValueError, match="missing required columns"):
                read_sites_csv(csv_path)
        finally:
            os.unlink(csv_path)

    def test_invalid_latitude_value(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon\nBad,999,-82\n")

        try:
            with pytest.raises(ValueError, match="Error parsing row|out of range"):
                read_sites_csv(csv_path)
        finally:
            os.unlink(csv_path)

    def test_non_numeric_latitude(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon\nBad,abc,-82\n")

        try:
            with pytest.raises(ValueError, match="Error parsing row"):
                read_sites_csv(csv_path)
        finally:
            os.unlink(csv_path)

    def test_duplicate_names(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon\nDup,35,-82\nDup,36,-83\n")

        try:
            with pytest.raises(ValueError, match="Duplicate site names"):
                read_sites_csv(csv_path)
        finally:
            os.unlink(csv_path)

    def test_column_aliases(self):
        """Accept latitude/longitude column names instead of lat/lon."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,latitude,longitude\nA,35.0,-82.0\n")

        try:
            result = read_sites_csv(csv_path)
            assert len(result) == 1
            assert result[0].latitude == 35.0
            assert result[0].longitude == -82.0
        finally:
            os.unlink(csv_path)

    def test_bom_header(self):
        """UTF-8 BOM in header is handled (utf-8-sig)."""
        import codecs

        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write(codecs.BOM_UTF8 + b"name,lat,lon\nSiteX,35.5,-82.5\n")

        try:
            result = read_sites_csv(csv_path)
            assert len(result) == 1
            assert result[0].name == "SiteX"
        finally:
            os.unlink(csv_path)

    def test_optional_elevation_column(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon,elevation\nTop,35.0,-82.0,1200.5\n")

        try:
            result = read_sites_csv(csv_path)
            assert result[0].elevation_m == 1200.5
        finally:
            os.unlink(csv_path)

    def test_optional_notes_column(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name
            f.write("name,lat,lon,notes\nA,35.0,-82.0,hello world\n")

        try:
            result = read_sites_csv(csv_path)
            assert result[0].notes == "hello world"
        finally:
            os.unlink(csv_path)

    def test_write_rejects_duplicates(self):
        sites = [
            CandidateSite(name="Dup", latitude=35.0, longitude=-82.0),
            CandidateSite(name="Dup", latitude=36.0, longitude=-83.0),
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            csv_path = f.name

        try:
            with pytest.raises(ValueError, match="Duplicate site names"):
                write_sites_csv(sites, csv_path)
        finally:
            os.unlink(csv_path)


# ── GeoJSON round-trip ──────────────────────────────────────────────────────


class TestGeojsonRoundTrip:
    def test_round_trip(self, sample_sites):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            geojson_path = f.name

        try:
            write_sites_geojson(sample_sites, geojson_path)
            reloaded = read_sites_geojson(geojson_path)

            assert len(reloaded) == len(sample_sites)
            for orig, new in zip(sample_sites, reloaded):
                assert orig == new
        finally:
            os.unlink(geojson_path)

    def test_round_trip_empty(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            geojson_path = f.name

        try:
            write_sites_geojson([], geojson_path)
            reloaded = read_sites_geojson(geojson_path)
            assert reloaded == []
        finally:
            os.unlink(geojson_path)

    def test_round_trip_with_nulls(self):
        sites = [
            CandidateSite(name="NoElev", latitude=35.0, longitude=-82.0),
            CandidateSite(name="WithElev", latitude=35.1, longitude=-82.1, elevation_m=100.0),
            CandidateSite(name="WithNotes", latitude=35.2, longitude=-82.2, notes="Some info"),
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            geojson_path = f.name

        try:
            write_sites_geojson(sites, geojson_path)
            reloaded = read_sites_geojson(geojson_path)
            assert reloaded[0].elevation_m is None
            assert reloaded[0].notes is None
            assert reloaded[1].elevation_m == 100.0
            assert reloaded[2].notes == "Some info"
        finally:
            os.unlink(geojson_path)


# ── GeoJSON edge cases ──────────────────────────────────────────────────────


class TestGeojsonEdgeCases:
    def test_empty_feature_collection(self):
        geojson = {"type": "FeatureCollection", "features": []}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            result = read_sites_geojson(geojson_path)
            assert result == []
        finally:
            os.unlink(geojson_path)

    def test_not_a_feature_collection(self):
        geojson = {"type": "Feature", "geometry": None}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            with pytest.raises(ValueError, match="FeatureCollection"):
                read_sites_geojson(geojson_path)
        finally:
            os.unlink(geojson_path)

    def test_missing_name_property(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-82.5, 35.5]},
                    "properties": {},
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            with pytest.raises(ValueError, match="missing required property 'name'"):
                read_sites_geojson(geojson_path)
        finally:
            os.unlink(geojson_path)

    def test_non_point_geometry(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                    "properties": {"name": "Road"},
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            with pytest.raises(ValueError, match="must be a Point"):
                read_sites_geojson(geojson_path)
        finally:
            os.unlink(geojson_path)

    def test_duplicate_names(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-82.5, 35.5]},
                    "properties": {"name": "Dup"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-82.6, 35.6]},
                    "properties": {"name": "Dup"},
                },
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            with pytest.raises(ValueError, match="Duplicate site names"):
                read_sites_geojson(geojson_path)
        finally:
            os.unlink(geojson_path)

    def test_write_rejects_duplicates(self):
        sites = [
            CandidateSite(name="Dup", latitude=35.0, longitude=-82.0),
            CandidateSite(name="Dup", latitude=36.0, longitude=-83.0),
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            geojson_path = f.name

        try:
            with pytest.raises(ValueError, match="Duplicate site names"):
                write_sites_geojson(sites, geojson_path)
        finally:
            os.unlink(geojson_path)

    def test_elevation_property_round_trip(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-82.5, 35.5]},
                    "properties": {"name": "Top", "elevation_m": 1500},
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            result = read_sites_geojson(geojson_path)
            assert result[0].elevation_m == 1500.0
        finally:
            os.unlink(geojson_path)

    def test_notes_property_round_trip(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-82.5, 35.5]},
                    "properties": {"name": "A", "notes": "Hello world"},
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            geojson_path = f.name

        try:
            result = read_sites_geojson(geojson_path)
            assert result[0].notes == "Hello world"
        finally:
            os.unlink(geojson_path)
