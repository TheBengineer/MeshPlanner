# Disaster Response Workflow — LoRa Mesh Network Planning

This document defines a structured workflow for planning a LoRa mesh network deployment using MeshPlanner. It guides a comms planner from defining the operational area through iterative rounds of site selection optimization.

---

## Phase 0 — Pre-Deployment Preparation

**Objective:** Gather intelligence and define the operational area before entering the field.

### 0.1 Define the Area of Interest (AOI)

Draw a bounding box around the affected region. Use administrative boundaries (county lines, city limits), geographic features (valleys, ridges), or known damage zones.

**Asheville, NC (Post-Helene) example:**
```
West:  -82.65  |  South:  35.45
East:  -82.35  |  North:  35.75
```

This 20×30 km box covers the Asheville urban area, Biltmore Forest, Swannanoa, and the surrounding Blue Ridge mountain terrain.

### 0.2 Identify Points of Interest (POI)

POIs are locations where communications are critical for coordinating the response. These anchor the mesh network design.

| POI Type | Examples | Priority | Connectivity Need |
|----------|----------|----------|-------------------|
| **Incident Command Post (ICP)** | EOC, fire station, school gym | 🔴 Critical | High-bandwidth backhaul + mesh coordination |
| **Staging Areas** | Parking lots, fairgrounds, airfields | 🔴 Critical | Supply logistics coordination |
| **Medical Triage** | Hospitals, field clinics, pharmacies | 🔴 Critical | Patient tracking, med supply requests |
| **Shelters** | Schools, churches, community centers | 🟡 High | Evacuee registration, welfare checks |
| **Water/Food Distribution** | Grocery stores, distribution centers | 🟡 High | Supply chain coordination |
| **Fuel/Charging Stations** | Gas stations, generator depots | 🟡 High | Equipment logistics |
| **SAR Base Camps** | Trailheads, park ranger stations | 🟢 Medium | Search team coordination |
| **Public Information Points** | Libraries, town halls | 🟢 Medium | Community updates |

**Asheville example POIs:**
```
ICP:      Asheville Fire Station 1  (35.595, -82.555)
Hospital: Mission Hospital          (35.577, -82.553)
Shelter:  Asheville High School     (35.568, -82.540)
Staging:  Asheville Regional Airport (35.434, -82.537)
SAR Base: Blue Ridge Parkway VC     (35.630, -82.510)
Water:    Ingles Markets             (35.610, -82.580)
```

### 0.3 Map Existing Communications Infrastructure

Document what already works and what doesn't. The mesh fills gaps, not replaces working infrastructure.

| Infrastructure | Status (Post-Helene) | Notes |
|---------------|---------------------|-------|
| **Cellular** | ❌ Down (towers damaged, no power) | Most towers offline for 2-6 weeks |
| **Landline** | ❌ Down (pole damage, CO flooded) | Widespread copper/fiber cuts |
| **Satellite** | ⚠️ Congested | Starlink terminals deployed but oversubscribed |
| **Ham Radio** | ✅ Operational | ARES/RACES active on 2m/70cm, limited coverage in valleys |
| **Public Safety Radio** | ⚠️ Partial | Some towers on generator, dead zones in terrain shadows |
| **Internet** | ❌ Down | Cable/fiber backbone damaged |

Mark known working comms as **Existing Sites** in MeshPlanner with `notes: "working [type]"`. These can serve as backhaul anchors for the mesh.

---

## Phase 1 — Initial Coverage Assessment

**Objective:** Determine which POIs are already covered by existing sites and identify coverage gaps.

### 1.1 Load Existing Sites

Add all existing communications infrastructure as candidate sites:
- Ham radio repeaters (known frequencies and locations)
- Public safety radio towers still operational
- Satellite terminal locations (Starlink)
- Any other working backhaul points

### 1.2 Compute Baseline Coverage

Run coverage simulation for each existing site with conservative parameters:
- **Band**: US915
- **SF**: 10 (balance of range and data rate)
- **TX Power**: 20 dBm
- **TX Height**: 10 m (typical building-mounted)
- **Threshold**: -120 dBm (minimum usable RSSI for SF10)
- **Max Range**: 15 km (conservative in mountainous terrain)

### 1.3 Identify Coverage Gaps

Use the coverage map to identify:
1. **Uncovered POIs** — POIs with RSSI < -120 dBm from all existing sites
2. **Terrain shadow zones** — areas behind ridges with no line-of-sight to any site
3. **Coverage boundaries** — the outer edge of the combined coverage area

**Output:** A list of POIs that need new gateway deployment, prioritized by criticality.

---

## Phase 2 — Candidate Site Generation

**Objective:** Generate candidate sites for new gateway deployments.

### 2.1 Generate Candidate Sites

Use MeshPlanner's site generation tools:

**Manual placement:** Drop pins on high points near uncovered POIs — hilltops, ridge lines, tall buildings.

**OSM import:** Fetch existing infrastructure that can host gateways:
```typescript
fetchOsmSites(bbox, ["fire_station", "school", "hospital", "tower", "water_tower"])
```
These are structurally sound locations with existing power (or generator capacity).

**Grid generation:** Generate a systematic grid covering the AOI:
```typescript
generateGrid(bbox, 1.0, "Grid")  // 1km spacing
```

**Hilltop detection:** Find natural high points in the DEM:
```typescript
detectHilltops(dem, demMeta, 100, 0.5)  // minProminence=100m, minDist=0.5km
```

### 2.2 Score Candidate Sites

Rank candidates by:
1. **Elevation** — higher = better line-of-sight
2. **Proximity to uncovered POIs** — closer = more value
3. **Existing infrastructure** — roads, power, building access
4. **Terrain suitability** — ridge-top vs valley floor

**Initial filter:** Retain the top 20-50 candidates for optimization.

---

## Phase 3 — Optimization (Iterative Rounds)

**Objective:** Find the minimum number of gateways needed to cover all critical POIs, then expand coverage in successive rounds.

### Round 1 — Critical Coverage (Minimum Viable Mesh)

**Goal:** Cover all 🔴 Critical POIs with minimum sites.

**Parameters:**
- Site pool: Top 20 candidates + existing sites
- Threshold: -120 dBm (SF10)
- Mode: Min Sites
- Target: Cover all 🔴 Critical POIs

**Run optimization:**

```
meshplanner optimize --mode min-sites --target 0.95 --sites candidates.csv --dem terrain.tif
```

Greedy result appears instantly. hiGHS ILP refines it in the background.

**Evaluate:**
- How many gateways are needed?
- Are the selected sites accessible? (road access, power, security)
- Do any selected sites conflict? (too close = interference)

**If no solution exists:** Increase max range, lower threshold (SF12 = -137 dBm), or add more candidate sites.

**Output:** A minimal mesh covering critical POIs with N gateways.

### Round 2 — Extended Coverage

**Goal:** Add coverage for 🟡 High-priority POIs using remaining budget.

**Parameters:**
- Existing sites from Round 1 (locked in)
- New candidate pool: remaining candidates near 🟡 POIs
- Threshold: -120 dBm
- Mode: Max Coverage
- N Sites: Round 1 count + 50% (if budget allows)

**Run optimization:**

```
meshplanner optimize --mode max-coverage --n-sites 8 --sites candidates_round2.csv --dem terrain.tif
```

**Evaluate:**
- What additional coverage does each new gateway provide?
- Are the new sites reachable from Round 1 sites? (mesh connectivity)
- Can any Round 1 sites be replaced by Round 2 choices?

### Round 3 — Redundancy & Reliability

**Goal:** Ensure every critical POI has at least 2 independent coverage paths (k=2 redundancy).

**Parameters:**
- All selected sites from Round 1+2 (locked in)
- Additional candidates for redundancy placement
- Mode: Adjust — manually place redundant gateways on different terrain features

**Manual process:**
1. For each 🔴 POI, check how many selected sites provide coverage
2. If < 2, identify a new candidate that covers this POI from a DIFFERENT azimuth
3. Add candidate and re-run Max Coverage

**Check:** Two gateways on the same ridge may fail together (landslide, wind). Redundant paths should use geographically diverse sites.

### Round 4 — Field Validation

**Goal:** Refine the plan based on real-world reconnaissance.

**Actions:**
1. Visit selected sites — verify road access, power availability, security
2. Update site notes with field assessment
3. Remove inaccessible sites, add alternatives
4. Re-run optimization with updated candidate pool
5. Produce final deployment plan with site rankings and fallback options

---

## Phase 4 — Deployment & Export

**Objective:** Produce actionable outputs for field teams.

### 4.1 Export Deployment Brief

```bash
meshplanner export --input results.json --format geojson --output deployment_sites.geojson
meshplanner export --input results.json --format csv --output deployment_sites.csv
meshplanner export --input results.json --format kml --output deployment_sites.kml
```

### 4.2 Deployment Brief Contents

**For each selected site:**
- Site name and coordinates (lat/lon)
- Access notes (road, trail, helicopter)
- Equipment needed (gateway, antenna, battery, solar panel)
- Estimated deployment time
- Gateway assignment (which other sites it connects to, which POIs it covers)

**Combined coverage map:**
- All selected site coverage footprints (union)
- POI markers with coverage status
- Terrain backdrop for field orientation

### 4.3 Field Package

- Printed map (11×17) with site locations and coverage zones
- GPS waypoints file (.kml for Garmin/phone)
- Site survey checklist (one per site)
- Deployment priority ranking

---

## Quick Reference Card

| Phase | Action | MeshPlanner Tool | Output |
|-------|--------|-----------------|--------|
| 0.1 | Define AOI | Draw bbox on map | Bounding coordinates |
| 0.2 | Identify POIs | Manual markers | POI list with priorities |
| 0.3 | Map existing comms | Add existing sites | Baseline site list |
| 1.1-1.3 | Baseline coverage | Compute per existing site | Coverage gap map |
| 2.1 | Generate candidates | OSM import / grid / hilltop | Candidate site list |
| 2.2 | Score candidates | Visual + manual ranking | Prioritized candidate list |
| 3.1 | Round 1: Critical | Min Sites optimization | Critical coverage plan |
| 3.2 | Round 2: Extended | Max Coverage optimization | Extended coverage plan |
| 3.3 | Round 3: Redundancy | Manual + Max Coverage | k=2 redundancy plan |
| 3.4 | Round 4: Validate | Field assessment | Final deployment plan |
| 4.1-4.3 | Export | GeoJSON/CSV/KML export | Deployment brief + maps |
