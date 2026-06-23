"""Shared test fixtures."""
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def asheville_bbox():
    """Bounding box for Asheville, NC test area (20x20 km)."""
    return {"west": -82.6, "south": 35.5, "east": -82.4, "north": 35.7}


@pytest.fixture
def demo_candidate_sites():
    """Minimal list of candidate sites for testing."""
    return [
        {"lat": 35.55, "lon": -82.55, "name": "Site A"},
        {"lat": 35.60, "lon": -82.50, "name": "Site B"},
        {"lat": 35.65, "lon": -82.45, "name": "Site C"},
    ]
