"""Candidate site data model and loading."""


class CandidateSite:
    """Represents a potential gateway/repeater location."""

    def __init__(self, lat, lon, name="", height=0.0):
        self.lat = lat
        self.lon = lon
        self.name = name
        self.height = height

