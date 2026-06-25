# =============================================================================
# Stage 1 — Build: install dependencies + package into a venv via uv
# =============================================================================
FROM python:3.12-slim AS builder

# Install uv — the fast Python package installer
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /build

# Copy project metadata first (better layer caching)
COPY pyproject.toml ./
COPY src/ src/

# Create a virtual environment and install everything, including web extras
RUN uv venv /opt/venv && \
    . /opt/venv/bin/activate && \
    uv pip install --no-cache ".[web]"

# =============================================================================
# Stage 2 — Runtime: minimal image with the venv + entrypoint
# =============================================================================
FROM python:3.12-slim

# Copy the fully-populated virtual environment from the builder
COPY --from=builder /opt/venv /opt/venv

# Create a dedicated non-root user
RUN groupadd --system meshplanner && \
    useradd --system --no-create-home -g meshplanner meshplanner

WORKDIR /app

# Copy the entrypoint router and source code (needed for streamlit run)
COPY entrypoint.py .
COPY src/ src/

# Fix ownership so the non-root user can write outputs (e.g. coverage rasters)
RUN chown -R meshplanner:meshplanner /app

# Activate the venv on PATH so streamlit / meshplanner are discoverable
ENV PATH="/opt/venv/bin:$PATH" \
    VIRTUAL_ENV="/opt/venv" \
    PYTHONUNBUFFERED=1

USER meshplanner

ENTRYPOINT ["python", "/app/entrypoint.py"]
