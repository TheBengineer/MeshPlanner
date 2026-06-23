"""LoRa parameter dataclasses and link budget calculation."""
from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

# Standard receiver sensitivity (dBm) by spreading factor at 125 kHz BW
# Source: Semtech SX1276 datasheet, typical values
SF_SENSITIVITY: Dict[int, float] = {
    7: -123,
    8: -126,
    9: -129,
    10: -132,
    11: -134,
    12: -137,
}

# Available frequency bands
BAND_CENTERS: Dict[str, float] = {
    "US915": 915.0,  # 902-928 MHz
    "EU868": 868.0,  # 863-870 MHz
    "AU915": 915.0,  # 915-928 MHz
    "AS923": 923.0,  # 915-928 MHz (varies by country)
    "CN470": 470.0,  # 470-510 MHz
    "IN865": 865.0,  # 865-867 MHz
    "KR920": 920.0,  # 920-923 MHz
}


@dataclass
class LoraParams:
    """LoRa link parameters for coverage simulation.

    Attributes:
        frequency_mhz: Center frequency in MHz (e.g., 915.0 for US915)
        spreading_factor: Spreading factor (7-12)
        tx_power_dbm: Transmitter power in dBm (typically 14-20)
        tx_antenna_gain_dbi: Transmitter antenna gain in dBi
        rx_antenna_gain_dbi: Receiver antenna gain in dBi
        rx_sensitivity_dbm: Receiver sensitivity in dBm (auto-set from SF if not specified)
        tx_height_m: Transmitter antenna height above ground in meters
        rx_height_m: Receiver antenna height above ground in meters
        bandwidth_hz: Bandwidth in Hz (default 125000 for LoRa)
        required_margin_db: Required link margin in dB (default 10 for disaster scenarios)
        cable_loss_tx_db: Cable/connector loss at transmitter in dB
        cable_loss_rx_db: Cable/connector loss at receiver in dB
    """
    frequency_mhz: float = 915.0
    spreading_factor: int = 10
    tx_power_dbm: float = 20.0
    tx_antenna_gain_dbi: float = 3.0
    rx_antenna_gain_dbi: float = 0.0
    rx_sensitivity_dbm: Optional[float] = None
    tx_height_m: float = 10.0
    rx_height_m: float = 1.5
    bandwidth_hz: float = 125000.0
    required_margin_db: float = 10.0
    cable_loss_tx_db: float = 0.5
    cable_loss_rx_db: float = 0.5

    def __post_init__(self):
        """Validate and set defaults."""
        if self.spreading_factor not in range(7, 13):
            raise ValueError(
                f"Spreading factor must be 7-12, got {self.spreading_factor}"
            )
        if self.rx_sensitivity_dbm is None:
            self.rx_sensitivity_dbm = SF_SENSITIVITY[self.spreading_factor]
        if self.frequency_mhz <= 0:
            raise ValueError(f"Frequency must be positive, got {self.frequency_mhz}")

    @classmethod
    def from_band(cls, band: str = "US915", spreading_factor: int = 10) -> "LoraParams":
        """Create LoraParams from a standard frequency band preset."""
        if band not in BAND_CENTERS:
            raise ValueError(
                f"Unknown band: {band}. Available: {list(BAND_CENTERS.keys())}"
            )
        return cls(
            frequency_mhz=BAND_CENTERS[band],
            spreading_factor=spreading_factor,
        )


@dataclass
class LinkBudget:
    """Link budget calculation result."""

    tx_eirp_dbm: float  # Equivalent Isotropic Radiated Power
    path_loss_db: float  # Path loss (from propagation model)
    rx_power_dbm: float  # Received signal power
    rx_sensitivity_dbm: float  # Receiver sensitivity
    margin_db: float  # Link margin (positive = link works)
    is_feasible: bool  # True if margin >= required margin

    @classmethod
    def calculate(cls, params: LoraParams, path_loss_db: float) -> "LinkBudget":
        """Calculate link budget given LoRa parameters and path loss.

        Args:
            params: LoRa link parameters
            path_loss_db: Path loss from propagation model (dB)

        Returns:
            LinkBudget with calculated fields
        """
        # EIRP = TX power + TX antenna gain - cable loss
        tx_eirp = (
            params.tx_power_dbm
            + params.tx_antenna_gain_dbi
            - params.cable_loss_tx_db
        )

        # RX power = EIRP - path loss + RX antenna gain - RX cable loss
        rx_power = (
            tx_eirp
            - path_loss_db
            + params.rx_antenna_gain_dbi
            - params.cable_loss_rx_db
        )

        # Margin = RX power - RX sensitivity
        margin = rx_power - params.rx_sensitivity_dbm

        return cls(
            tx_eirp_dbm=round(tx_eirp, 1),
            path_loss_db=round(path_loss_db, 1),
            rx_power_dbm=round(rx_power, 1),
            rx_sensitivity_dbm=params.rx_sensitivity_dbm,
            margin_db=round(margin, 1),
            is_feasible=margin >= params.required_margin_db,
        )

    def __str__(self) -> str:
        """Human-readable link budget summary."""
        status = "✅ FEASIBLE" if self.is_feasible else "❌ NOT FEASIBLE"
        return (
            f"Link Budget ({status})\n"
            f"  TX EIRP:       {self.tx_eirp_dbm:>6.1f} dBm\n"
            f"  Path Loss:     {self.path_loss_db:>6.1f} dB\n"
            f"  RX Power:      {self.rx_power_dbm:>6.1f} dBm\n"
            f"  RX Sensitivity:{self.rx_sensitivity_dbm:>6.1f} dBm\n"
            f"  Margin:        {self.margin_db:>6.1f} dB\n"
        )


def estimate_range_km(params: LoraParams, free_space: bool = False) -> float:
    """Estimate max range for a LoRa link (approximate).

    Uses simple log-distance model: PL = PL0 + 10*n*log10(d/d0)
    where n=3.5 for urban, n=2.5 for suburban, n=2.0 for free space.

    Args:
        params: LoRa link parameters
        free_space: If True, use free-space path loss (n=2); otherwise suburban (n=2.5)

    Returns:
        Estimated range in km
    """
    # Free space path loss at 1 km
    pl0 = 32.45 + 20 * np.log10(params.frequency_mhz) + 20 * np.log10(1.0)

    # Path loss exponent
    n = 2.0 if free_space else 2.5

    # Available path loss = TX EIRP - RX sensitivity - required margin
    # (excluding antenna gains which are vary by deployment)
    available_pl = (
        params.tx_power_dbm
        - params.cable_loss_tx_db
        - params.rx_sensitivity_dbm
        - params.required_margin_db
        - params.cable_loss_rx_db
    )

    # Solve for distance: available_pl = pl0 + 10*n*log10(d)
    if available_pl <= pl0:
        return 0.0

    d_km = 10 ** ((available_pl - pl0) / (10 * n))
    return round(d_km, 2)
