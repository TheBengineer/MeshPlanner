#!/usr/bin/env python3
"""
ITM Cross-Validation Runner.

Loads each canonical terrain profile, computes the Python ITM golden value,
invokes the JS ITM engine via Node/tsx, and reports the comparison.

Usage:
    python tests/cross_validation/runner.py                    # full report
    python tests/cross_validation/runner.py --json             # JSON output
    python tests/cross_validation/runner.py --fail-fast        # exit on first diff > tolerance
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml

from meshplanner.propagation.itm import compute_path_loss

REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILES_DIR = REPO_ROOT / "tests" / "cross_validation" / "data" / "canonical"
JS_TEST_SCRIPT = (
    REPO_ROOT
    / "meshplanner-app"
    / "src"
    / "tests"
    / "cross_validation"
    / "test_js.test.ts"
)

# Colours for terminal output
_GREEN = "\033[92m"
_RED = "\033[91m"
_YELLOW = "\033[93m"
_CYAN = "\033[96m"
_BOLD = "\033[1m"
_RESET = "\033[0m"


def _load_profiles() -> list[dict]:
    files = sorted(PROFILES_DIR.glob("*.yaml"))
    profiles = []
    for f in files:
        with open(f) as fh:
            doc = yaml.safe_load(fh)
        profiles.append(doc["canonical_terrain_profile"])
    return profiles


def _run_python(profile: dict) -> dict:
    """Run Python ITM for a profile and return full result dict."""
    params = profile["propagation_params"]
    return compute_path_loss(
        elevations=profile["elevations"],
        total_distance_km=params["total_distance_km"],
        frequency_mhz=params["frequency_mhz"],
        tx_height_m=params["tx_height_m"],
        rx_height_m=params["rx_height_m"],
        polarization=params["polarization"],
        climate=params["climate"],
        ground_permittivity=params["ground_permittivity"],
        ground_conductivity=params["ground_conductivity"],
        surface_refractivity=params["surface_refractivity"],
    )


def _run_js() -> list[dict]:
    """Invoke Node/tsx to run the JS ITM and return parsed results."""
    result = subprocess.run(
        ["npx", "tsx", str(JS_TEST_SCRIPT)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT / "meshplanner-app",
        timeout=60,
    )
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}", file=sys.stderr)
        result.check_returncode()
    data = json.loads(result.stdout)
    return data["results"]


def _compare(
    py_result: dict,
    js_entry: dict,
    expected: dict,
) -> dict:
    """Compare Python and JS results for a single profile."""
    pl_dev = js_entry["js_path_loss_db"] - py_result["path_loss_db"]
    fs_dev = js_entry["js_free_space_loss_db"] - py_result["free_space_loss_db"]
    ex_dev = js_entry["js_excess_loss_db"] - py_result["excess_loss_db"]

    pl_tol = expected["path_loss_tolerance"]
    fs_tol = expected["free_space_tolerance"]
    ex_tol = expected["excess_loss_tolerance"]

    return {
        "profile": js_entry["profile"],
        "python": {
            "path_loss_db": py_result["path_loss_db"],
            "free_space_loss_db": py_result["free_space_loss_db"],
            "excess_loss_db": py_result["excess_loss_db"],
        },
        "javascript": {
            "path_loss_db": js_entry["js_path_loss_db"],
            "free_space_loss_db": js_entry["js_free_space_loss_db"],
            "excess_loss_db": js_entry["js_excess_loss_db"],
        },
        "deviation": {
            "path_loss_db": round(pl_dev, 1),
            "free_space_loss_db": round(fs_dev, 1),
            "excess_loss_db": round(ex_dev, 1),
        },
        "within_tolerance": {
            "path_loss_db": abs(pl_dev) <= pl_tol,
            "free_space_loss_db": abs(fs_dev) <= fs_tol,
            "excess_loss_db": abs(ex_dev) <= ex_tol,
        },
    }


def main():
    args = set(sys.argv[1:])
    as_json = "--json" in args
    fail_fast = "--fail-fast" in args

    profiles = _load_profiles()

    print(
        f"{_BOLD}ITM Cross-Validation Runner{_RESET}\n"
        f"  Engine:     Python (itmlogic) vs JS (knife-edge diffraction)\n"
        f"  Profiles:   {len(profiles)}\n"
    )

    # Run Python ITM on all profiles
    py_results = {}
    for p in profiles:
        py_results[p["name"]] = _run_python(p)

    # Run JS ITM via Node/tsx
    js_results_list = _run_js()
    js_results = {r["profile"]: r for r in js_results_list}

    # Compare
    comparisons = []
    for p in profiles:
        name = p["name"]
        py = py_results[name]
        js = js_results[name]
        cmp = _compare(py, js, p["expected_loss"])
        comparisons.append(cmp)

    if as_json:
        print(json.dumps(comparisons, indent=2))
        return

    # Terminal report
    total = len(comparisons)
    passed = 0
    failed = 0

    for cmp in comparisons:
        wt = cmp["within_tolerance"]
        all_ok = wt["path_loss_db"] and wt["free_space_loss_db"] and wt["excess_loss_db"]
        status = f"{_GREEN}PASS{_RESET}" if all_ok else f"{_RED}FAIL{_RESET}"
        icon = "✓" if all_ok else "✗"

        if all_ok:
            passed += 1
        else:
            failed += 1
            if fail_fast:
                print(f"\n{_RED}Failing fast on {cmp['profile']}{_RESET}")

        d = cmp["deviation"]
        wt_labels = {
            k: f"{'✓' if v else '✗'} {k.replace('_', ' ')}"
            for k, v in wt.items()
        }
        print(
            f"  {icon} {_BOLD}{cmp['profile']:25s}{_RESET}  {status}\n"
            f"     Python  PL={cmp['python']['path_loss_db']:6.1f} dB  "
            f"FS={cmp['python']['free_space_loss_db']:6.1f} dB  "
            f"EX={cmp['python']['excess_loss_db']:5.1f} dB\n"
            f"     JS      PL={cmp['javascript']['path_loss_db']:6.1f} dB  "
            f"FS={cmp['javascript']['free_space_loss_db']:6.1f} dB  "
            f"EX={cmp['javascript']['excess_loss_db']:5.1f} dB\n"
            f"     Δ       PL={d['path_loss_db']:6.1f} dB  "
            f"FS={d['free_space_loss_db']:6.1f} dB  "
            f"EX={d['excess_loss_db']:5.1f} dB\n"
            f"     Tol:    {wt_labels['path_loss_db']}, "
            f"{wt_labels['free_space_loss_db']}, "
            f"{wt_labels['excess_loss_db']}"
        )

    print(
        f"\n{'=' * 60}\n"
        f"  Results: {_GREEN}{passed} passed{_RESET}, "
        f"{_RED}{failed} failed{_RESET} / {total} total\n"
        f"  Note: JS uses a simplified knife-edge model; "
        f"mismatches for complex terrain are expected.\n"
        f"  For golden-data regression tests, run:\n"
        f"    pytest tests/cross_validation/   (Python)\n"
        f"    npx vitest run --project cross-validation  (JS)\n"
    )

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
