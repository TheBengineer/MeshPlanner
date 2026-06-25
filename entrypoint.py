#!/usr/bin/env python3
"""MeshPlanner Docker entrypoint — routes to CLI or Streamlit.

Usage (inside container):
    docker run meshplanner              → Streamlit web UI (port 8501)
    docker run meshplanner web          → Streamlit web UI (port 8501)
    docker run meshplanner cli <args>   → meshplanner CLI <args>
"""
from __future__ import annotations

import os
import sys
import subprocess  # noqa: S404


def run_streamlit() -> None:
    """Launch the Streamlit web UI."""
    port = os.environ.get("STREAMLIT_PORT", "8501")
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        "src/meshplanner/web/app.py",
        f"--server.port={port}",
        "--server.address=0.0.0.0",
    ]
    sys.exit(subprocess.call(cmd))  # noqa: S603


def run_cli(args: list[str]) -> None:
    """Run the meshplanner CLI with the given arguments."""
    cmd = [sys.executable, "-m", "meshplanner.cli.app", *args]
    sys.exit(subprocess.call(cmd))  # noqa: S603


def main() -> None:
    if len(sys.argv) <= 1:
        # No args → web UI
        run_streamlit()
        return

    dispatch = sys.argv[1]

    if dispatch == "cli":
        # docker run meshplanner cli coverage ...
        run_cli(sys.argv[2:])
    elif dispatch == "web":
        run_streamlit()
    else:
        # Unknown subcommand — assume it's a CLI command for convenience
        # (e.g. docker run meshplanner coverage ...)
        run_cli(sys.argv[1:])


if __name__ == "__main__":
    main()
