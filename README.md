# Lunar Mission Window Analyzer

**English** | [Türkçe](README.tr.md)

NASA Space Apps Challenge 2026 — *Lunar Landing Site Navigator*. For a location near the lunar south pole, the app computes the local terrain horizon from **real NASA LOLA terrain data** and **NAIF SPICE ephemerides**. Over the mission time window it evaluates how much of the Sun disk is visible and whether the Earth centre is above the horizon (geometric DTE), then gives a `GREEN / YELLOW / RED / GRAY` screening decision against the mission constraints.

> **This is a screening / decision-support tool.** It does not guarantee landing safety, electrical power generation or an RF link, and it is not a NASA approval or a landing certification. When data is missing, no result is invented: the app shows `DEM_MISSING`, `SPICE_MISSING`, `CLONE_NOT_PRECOMPUTED` or `GRAY`.

The web interface is in **English** (default) and **Turkish** (`EN | TR` switch in the header).

## Contents
1. [Quick start](#quick-start)
2. [NASA data used](#nasa-data-used)
3. [Interface (P0 screens)](#interface-p0-screens)
4. [Demo steps](#demo-steps)
5. [Scientific model and limitations](#scientific-model-and-limitations)
6. [API](#api)
7. [Tests and validation status](#tests-and-validation-status)
8. [Deep-link check (Moon Trek / QuickMap)](#deep-link-check)
9. [Security and resource limits](#security-and-resource-limits)
10. [Known gaps](#known-gaps)

## Quick start

Requirements: **Python 3.11+**, **Node.js 20+** (tested with Python 3.11.9, Node 24.14.0, npm 11.9.0, Windows 11). Run the commands **from the project root**.

```powershell
# 1) Python dependencies (optional virtual environment)
py -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2) NASA data: NAIF kernels (~45 MB) + LOLA 240 m reference DEM (~219 MB)
python -m backend.download_data --include-lola-240m
#    Optional: ERR layer (~267 MB) -> "err" uncertainty mode (needed for GREEN/YELLOW)
python -m backend.download_data --include-lola-240m-err
#    Optional (LOD + slope): 80 m DEM (~189 MB) + 80 m ERR (~255 MB), Site01/Site04 5 m surf/toterr/slp (6 × ~41 MB)
python -m backend.download_data --include-lola-80m --include-lola-80m-err --include-site-5m
#    Optional: Site07/11/23 5 m (~0.5 GB), EFFRES effective resolution (240 + 80 m, ~510 MB),
#    DEM clones (100 × ~41 MB per site) + clone horizon precomputation (~4 min per location)
python -m backend.download_data --include-site-5m-extra --include-lola-effres
python -m backend.download_data --include-site-clones Site01 [--clone-range 1-100]
python -m backend.clone_engine --lat -89.46316 --lon -137.48955

# 3) Backend (single API worker; --reload only for local development)
uvicorn backend.main:app --host 127.0.0.1 --port 8000
#    OpenAPI: http://127.0.0.1:8000/docs   Health: http://127.0.0.1:8000/health

# 4) Frontend (separate terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Environment variables:

| Variable | Where | Default | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | `frontend/.env` | `http://127.0.0.1:8000` | Backend address. With `/api` the Vite dev proxy is used. |
| `LUNAR_CORS_ORIGINS` | backend shell | `http://localhost:5173,http://127.0.0.1:5173` | Explicit origin list; `*` is rejected at startup. |
| `CSPICE_SHARED_LIB` | backend shell | — | Full path if spiceypy cannot find `cspice.dll` (seen once, temporarily, on this machine). |

Examples: [`.env.example`](.env.example), [`frontend/.env.example`](frontend/.env.example).

### Serving from this PC: IIS + Cloudflare Tunnel (Windows)

The interface and the backend are served from the same address; the NASA data (`data/`) stays on this computer:

```
Visitor ─► https://<subdomain>.<your-domain> (Cloudflare, HTTPS)
        ─► Cloudflare Tunnel (cloudflared: an outbound connection from this computer)
        ─► IIS 127.0.0.1:80 ─┬─ /       → frontend/dist (static interface)
                             └─ /api/*  → URL Rewrite + ARR → FastAPI 127.0.0.1:8000
```

No router port is opened. IIS and the backend listen only on `127.0.0.1`. The interface is built with `VITE_API_BASE_URL=/api`, so
requests go to the same address and no CORS setting is needed. The routing rules are in [`frontend/public/web.config`](frontend/public/web.config);
Vite copies this file into `dist/`.

1. **Once, in an Administrator PowerShell:**
   `Set-ExecutionPolicy -Scope Process Bypass -Force; & '<project>\deploy\windows\setup-iis-admin.ps1'`
   The script [`setup-iis-admin.ps1`](deploy/windows/setup-iis-admin.ps1):
   - enables the IIS features;
   - downloads URL Rewrite 2.1 and ARR 3.0 from Microsoft and installs them only if the Microsoft signature is valid;
   - enables the ARR proxy;
   - creates the `LunarAnalyzer` site bound only to `127.0.0.1:80` and stops `Default Web Site`;
   - registers the `LunarAnalyzerBackend` task that starts the backend at logon;
   - installs `cloudflared`.
2. **Publish the interface (normal PowerShell):** `deploy\windows\publish-frontend.ps1` builds it and copies it to `C:\inetpub\lunar-analyzer`.
   Do **not** set `VITE_API_BASE_URL=/api` in Git Bash: Git Bash turns `/api` into a Windows path and produces a broken build.
3. **Backend:** `Start-ScheduledTask -TaskName LunarAnalyzerBackend`. It starts by itself at later logons, and
   [`run-backend.ps1`](deploy/windows/run-backend.ps1) restarts it if it exits. Uvicorn runs with `--proxy-headers`, so the
   limit of 5 analyses per minute applies to each visitor's IP separately. Logs: `logs/backend-service.log` and `logs/uvicorn-prod-*.log`.
4. **Cloudflare Tunnel** (the domain's DNS must be on Cloudflare):
   - Cloudflare Zero Trust → *Networks → Tunnels → Create a tunnel* (Cloudflared).
   - Run the `cloudflared.exe service install <token>` command shown for Windows in an Administrator PowerShell. The token is secret; do not share it.
   - Add a *Public hostname*: subdomain + domain, Service `HTTP`, URL `127.0.0.1:80`.

Limits:
- The computer must be on, with the user logged in. The backend is a logon task because Microsoft Store Python does not run reliably under a service account.
- If the computer or the backend is off, the site shows **Backend: Offline**; no fake result is produced.
- IIS on client editions of Windows limits concurrent requests. Enough for a demo, not for heavy traffic.
- Computations use this computer's CPU: at most 2 worker processes and at most 6 jobs.

To stop: run `Stop-ScheduledTask -TaskName LunarAnalyzerBackend` first, then end the `python` process on port 8000.

## NASA data used

| File (under `data/`, not added to Git) | Source | Status (2026-11-14) | Verification |
|---|---|---|---|
| `spice/naif0012.tls`, `pck00011.tpc`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` | [NASA JPL NAIF generic_kernels](https://naif.jpl.nasa.gov/naif/) | present | header (`KPL/`, `DAF/`) + local SHA-256; coverage verified by V-01 |
| `lola/LDEM_60S_240MPP_ADJ.TIF` (218,961,039 B) | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) — `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF` | present | HTTP 200 + Content-Length match + rasterio: 1 band float32, 7760×7760, 240 m, CRS *Moon (2015) - Sphere / Ocentric / South Polar* (Polar Stereographic B, lat_ts −90°, lon_0 0°, R = 1,737,400 m), NoData = NaN, z −9127…7025 m |
| `lola/LDEM_60S_240MPP_ADJ_ERR.TIF` (267,005,175 B) | same product page | present (optional download) | same chain; same CRS/grid, NoData NaN, polar sample σ 0.02–0.17 m |
| `lola/LDEM_80S_80MPP_ADJ.TIF` (+ `_ERR`) | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) `/data/LOLA_20mpp/` | `--include-lola-80m` / `--include-lola-80m-err` | same chain; used for the horizon ring within 30 km (LOD) |
| `sites/Site01_final_adj_5mpp_{surf,toterr,slp}.tif`, `sites/Site04_…` | [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78) `/data/LOLA_5mpp/` (Barker et al. 2021, PSS 203:105119) | `--include-site-5m` | 5 m/pixel, 16 × 16 km tile, south polar stereographic (R 1737.4 km), NoData NaN; empty `_surf` pixels are **filled by interpolation** (README); `_toterr` RMS (m); `_slp` official slope (°) used only for validation. Site01 = *Connecting ridge*, Site04 = *Shackleton rim* (PGDA README; tile names, not landing sites) |
| `sites/Site07_…`, `Site11_…` (3200² × 5 m), `Site23_…` (4200² × 5 m, 21 × 21 km) `{surf,toterr,slp}` | [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78) | `--include-site-5m-extra` | same chain; Site07 Peak near Shackleton, Site11 de Gerlache rim, Site23 Malapert massif (README). The product page says "no error estimate for Site23", but `Site23_…_toterr.tif` exists and holds values 0.07–10.5 m (median 0.47 m) (2026-11-14) |
| `lola/LDEM_60S_240MPP_ADJ_EFFRES.TIF` (259,831,703 B), `lola/LDEM_80S_80MPP_ADJ_EFFRES.TIF` (250,228,467 B) | [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90): "LDEM effective resolution (in meters)" | `--include-lola-effres` | same chain + EFFRES-01 (same grid as the DEM). **Data-quality information only**: it does not change the horizon, the metrics or the decision |
| `sites/clones/Site01/Site01_final_adj_5mpp_NNNN_err.tif` (100 × ~41 MB) | product 78 `SiteNN/Clones/` ("100 clones of LDEM") | `--include-site-clones Site01` (Site01/04/07/11 in the catalogue) | each clone is a full 5 m elevation map on the same grid as `_surf` (the match is checked for every file); clone − surf std 0.44 m (Site01 #1) |
| `LDEM_80S_20MPP_ADJ.TIF`, Site06/20/Haworth/Shoemaker/DM2 | PGDA | **not downloaded** | — |

- Note: the 5 m site DEMs are published in **product 78, not product 90** (checked 2026-11-14). The downloader accepts only the official (name, URL) pairs in its catalogue.
- LOD: 0–5 km of each horizon ray is sampled from the finest available layer (5 m site → 80 m → 240 m), 5–30 km from 80 m, and beyond that from 240 m. **In ERR mode only DEMs that have an ERR layer are used**; the others are reported with a reason in `excluded_layers` (mixing layers would make ERR rays NaN and fall back to GRAY).
- LOLA: *A New View of the Lunar South Pole from LOLA* — Barker et al. 2023, PSJ 4:183, DOI 10.3847/PSJ/acf3e1; data DOI 10.60903/gsfcpgda-lola-spole. According to the product page, elevations are in metres and positions are polar stereographic in the **MOON_ME (DE421)** frame.
- SPICE frame **`MOON_ME_DE440_ME421`** is defined in the NAIF frame kernel as closely aligned with the DE421 mean-Earth frame → consistent with the LOLA products. The PA→ME difference measured 103.9″ on 2026-12-01; the code uses ME everywhere.
- PGDA **does not publish checksums** for these files. The SHA-256 in the manifest is for local traceability only (`official_sha256_matched: false`).
- Downloader safety: lock file + 30 s heartbeat (a concurrent download is refused — seen in a real run with parallel downloads), orphan `.part`/lock cleanup, disk pre-check, mandatory Content-Length, **resume with HTTP Range within the same call** after a dropped or truncated transfer (at most 4 attempts; 206 + `Content-Range` and ETag must match), rasterio validation, atomic `os.replace`. An existing invalid file is never overwritten. On 2026-11-14 the first transfer of the 80 m DEM really arrived truncated (187.36/189.16 MB) and was rejected.

## Interface (P0 screens)

React 19 + Vite 8 + TypeScript 6 (strict) + Tailwind 4 + Plotly.js (`react-plotly.js/factory` + `plotly.js-dist-min`, separate lazy chunk).

**Visual design: a “Deep Space / Glassmorphism” mission-control panel.** Only the presentation layer is styled; the backend,
computations, API contract and decision rules are unchanged by it.
- The Tailwind 4 configuration lives in CSS (`frontend/src/index.css` → `@theme`): dark space background (fixed decorative star field),
  frosted-glass cards (`glass` / `glass-inner`, `backdrop-blur`), NASA-blue (#0B3D91 → #1F62E0) primary buttons, neon cyan accents,
  `term` / `module` terminal surfaces for the engineer view. `prefers-reduced-transparency` → opaque surfaces,
  `prefers-reduced-motion` → no animation. Text colours meet WCAG AA on the dark glass surfaces (description text ≥ 8:1).
- Typography: Space Grotesk (headings), Inter (body), JetBrains Mono (telemetry) — served **locally** via `@fontsource-variable`
  (no third-party font request; Turkish characters are in the latin-ext subset).
- Plotly charts draw the same data with the same traces; only background/grid/font colours follow the theme.

| Tab | Content |
|---|---|
| Header | Backend Online/Offline, SPICE / LOLA DEM (available resolutions, e.g. "240 · 80 · 5 m") / ERR / Clone status chips, "All times UTC", **Public / Engineer** switch (changes presentation only; the decision stays the same — verified by tests and E2E), **EN / TR** language switch |
| **Mission Setup** | `/sites` layers ("needs download" label), latitude −90…−80 / longitude −180…180, separate UTC date + time (the browser time zone is never used; ISO `Z` preview), mission/buffer/step, 135/200 km, panel and DTE antenna heights (1/4/40 m), nominal/err/clone, constraints, sampling budget; 202 + 2 s polling; result summary, violation UTC intervals, provenance, copyable summary; Earth–Moon education card in Public mode |
| **Sky View** | 0–360° panorama (0 = North, 90 = East), real `/horizon` profile, Sun/Earth discs at their **true angular size** (0/360 wrap), ERR band only if the API provides it, missing rays marked, separate antenna horizon, zoom to a body, south-pole azimuth/meridian note |
| **Timeline** | f_sun and geometric DTE from `scenarios[].timeline`, longest darkness/outage highlighted, click + keyboard slider (synchronised with Sky View), +0/+24/+48/+72 scenarios, new slips via `/scenarios/shift` (the parent is kept), elevation-vs-horizon chart in Engineer mode |
| **Compare** | Only completed analyses with the same mission profile; `/compare` priority (balanced/sun/comms/resilience); ranked GREEN/YELLOW lists, RED/GRAY cards with reasons; the interface never computes its own score |
| **Data & Validation** | `/health` ("file present" ≠ "scientifically validated"), layer table + download commands, `/validation` PASS/FAIL/BLOCKED/NOT_RUN + evidence, NASA sources, limitations |

Error / empty states: no backend (`BACKEND_OFFLINE`), `SPICE_MISSING`, `DEM_MISSING`, `TERRAIN_UNAVAILABLE`, `CLONE_NOT_PRECOMPUTED`, `WORKER_UNAVAILABLE`, `ANALYSIS_TIMEOUT`, 422 (per field), 429 `RATE_LIMITED`/`QUEUE_FULL`, 409 not ready, 404 (after a server restart), `INCOMPARABLE`. Codes are always shown together with text; unknown codes are never hidden.

### Public / Educator and Engineer modes (same result, different presentation)

| | Public / Educator | Engineer |
|---|---|---|
| Mission form | **Mission Wizard** (4 steps: Location → Time → Needs → Review). Accessible stepper (`aria-current="step"`, state given as text); “Next” validates the current step and focus moves to the new step heading. All steps stay in the DOM (only one is visible); “Start analysis” is available on every step and jumps to the step of the invalid field. The Location step offers **5 m tile shortcuts** from the `/sites` raster coverage centres (with a “not an official landing site” note). Buffer, time step, scan radius, ERR k, darkness threshold, slope and footprint are in the **"Advanced mission settings" accordion** (Review step; closed; opens itself if a hidden field is invalid) | **Cockpit / terminal** form: dense single screen with monospace `01…05` modules (Location/DEM, Time, Observer/horizon, Uncertainty, Constraints); `MOON_ME_DE440_ME421` unit vector of the entered location; live `POST /analyses` body preview (JSON); horizon computation-load details |
| Result | **Verdict banner** (icon + word + one sentence), **infographic KPI cards** (ring gauge + target line for Sun visibility and Earth view; duration bar with limit marker for the longest darkness and the longest Earth outage), **mission-window strip** (+0 h: f_sun area from the API timeline, geometric DTE bands, the server's longest darkness/outage intervals, mission end/buffer, unknown samples hatched), **landing-slip boxes** (+0/+24/+48/+72; from the server's violation list), plain-language story, "Why this result?", plain-language limitations and a featured **Earth–Moon education card** (axial tilts drawn with sourced angles; sizes not to scale) | **Decision read-out** (decision, nominal/conservative violation counts, unresolved checks, scenarios, horizon, uncertainty, quality), **terminal telemetry**: `MOON_ME_DE440_ME421`, MOON_ME x/y/z of both sensors (same spherical conversion as `latrec`), DEM layers + resolution, unused layers, observer altitude table (h_DEM + h_obs → r), ERR σ, cache key, slope; **violation UTC intervals table**; **horizon summary** (min/max, missing rays, band width, ray DEM coverage); scenario metrics table |
| Sky View | Panorama + live explanation + Learn card | Horizon summary (terminal): panel/antenna profile min/max angle and azimuth, missing rays, panel–antenna difference, ERR band width, ray DEM coverage |
| Timeline | f_sun / DTE chart, slips | Sun/Earth elevation chart **on top**, **JSON / CSV raw-data export** (API values only) |

Error and missing-data UX (user decision, 2026-11-14): codes are **never removed in either mode**.
- **Public:** `DEM_MISSING`, `SPICE_MISSING`, `CLONE_NOT_PRECOMPUTED` etc. are not shown as headings. A plain-language heading comes first (e.g. “Terrain data is not available yet”), then the explanation and “What you can do”. The raw code, the technical explanation and the command are in a keyboard-accessible **“Technical details”** (`<details>`) section. The analysis list and the Compare reasons also use the plain heading.
- **Engineer:** technical heading + raw code chip + engineer explanation + command, shown directly.
- Accessibility: error boxes use `role=alert` (warnings `role=status`); after a failed submit, focus moves to the error box. `e2e:states` checks every state in both modes and opens “Technical details” **with the keyboard** in Public mode; axe reports 0 violations on the error screens.
- Also hidden in Public mode: raw status labels, violation codes, metric/provenance tables and the cache key.

### Interface language: English / Türkçe

- The main interface is **English**; the **EN | TR** button in the header switches the whole interface to Turkish (tab names, form, results,
  error boxes, Plotly axis/trace names, the copied summary). The choice is remembered in the browser (`localStorage`); it can also be set
  by adding `?lang=tr` or `?lang=en` to the link. `<html lang>` follows the selected language.
- Like the Public/Engineer mode, the language changes **presentation only**: the API request, the decision (GREEN/YELLOW/RED/GRAY) and all
  numbers are the same. Units follow the language (`12.5 h` / `12.5 sa`, `40%` / `%40`, `S/W` / `G/B`); the decimal separator is a point in both.
- Codes are never translated (`DEM_MISSING`, `MAX_DARKNESS`, decision words). The backend's Turkish `mission.label` /
  `explanations.public` text is not shown; the same sentence is rebuilt in both languages from `status` + `radius_policy` + uncertainty mode
  (`frontend/src/lib/decisionText.ts`; a test checks that the Turkish output is identical to the backend text).
  The backend's English technical messages (e.g. `reason`, validation report fields) are shown verbatim as evidence.
- CSV/JSON export column names are fixed and independent of the language.
- Structure: `frontend/src/i18n.tsx` (`defineStrings` keeps `en`/`tr` strings next to each component; the `tr` object must have exactly
  the keys of `en`, which TypeScript checks at compile time).

## Demo steps

1. Start the backend and the frontend; the header should show **Backend: Online** and **LOLA DEM: 240 m**.
2. **Mission Setup** → “Fill in the documented example coordinate (−89.54°, 0°)” → **Start analysis**. *Completed* within ~2–60 s; decision **RED** (this point is in a −754 m depression: the Sun and Earth stay behind the terrain).
3. Set latitude/longitude to **−89.4512, −137.1427** and start again (a ridge point with DEM elevation 1950.3 m, next to the highest pixel within 40 km of the pole — 1954.3 m @ −89.4455°, −137.3137°; *not an official candidate*). Result: the Sun disk is 100% visible during the mission, but in the 1–4 December 2026 window the Earth is below the horizon (−1.9° … −4.6°) → DTE 0% → **RED**. For the same point the Earth is clearly above the local horizon on 16–24 December 2026; changing the landing date changes the result.
4. **Sky View**: the panorama, “Zoom to the Sun”, move the slider with the arrow keys.
5. **Timeline**: scenarios +24/+48/+72; add “+6 h” and **Compute slip scenarios** → a new analysis is listed.
6. **Compare**: select the two location analyses → **Compare**. Both are RED, so there is no Pareto ranking; the reasons and QuickMap/Moon Trek links are shown.
7. Switch to **Engineer** mode (top right): same decision, plus az/el, UTC, metrics table, violation intervals, DEM source, cache key.
8. Switch the language with **EN | TR**: the same decision and values, in Turkish.
9. **Data & Validation**: kernel/layer status and the recorded real validation results.
10. **GREEN example with ERR:** uncertainty **ERR ±k** (k = 1), landing **2026-12-17 00:00 UTC**, two locations with the same constraints: (−89.4512, −137.1427) and (−88.6663, −68.2302) (the second is the second-highest pixel in the DEM within 60 km of the pole, ≥ 8 km from the first, 1809.9 m; *not an official candidate*). Real result: both **GREEN** — in every +0/24/48/72 scenario, in the nominal and the conservative (ERR +1σ) variant: Sun disk 100%, DTE 100%, darkness/outage 0 h. **Compare**: two GREEN candidates, neither Pareto-dominates the other. This says the defined constraints are met in this 60-hour window with the 240 m DEM; slope was not evaluated and it is not landing safety. GREEN/YELLOW is only possible in ERR mode.

## Scientific model and limitations

- Location: Moon Mean-Earth (`MOON_ME_DE440_ME421`), planetocentric latitude, east-positive longitude, sphere R = 1737.4 km, radial local vertical; observer radius `1737.4 km + (h_DEM + h_sensor)/1000`. The panel and the DTE antenna can have different heights.
- Sun/Earth: SPICE `spkcpo`, `LT+S`, DE440s, UTC→ET (`naif0012.tls`). At exactly −90° the azimuth is defined relative to the meridian of the entered longitude.
- Horizon: 3600 azimuths (0.1°), 200 km reference radius (API limit; 250 km only in offline validation), distance-dependent step (20/80/240 m), bilinear sampling; a missing pixel makes that ray NaN (no zero filling) → `partial` → GRAY.
- Sun visibility: finite-disk fraction `f_sun`, equal-area polar quadrature + two-level difference report. **It is not electrical power generation.**
- DTE: only whether the Earth **centre** is above the terrain horizon. **It is not an RF link budget.**
- Decision: nominal violation → RED; nominal passes but conservative (ERR +k) violates → YELLOW; missing data/validation → GRAY; GREEN only if nominal + conservative pass. **Nominal mode alone never produces GREEN.**
- **DEM clone mode (v1.3):** uses PGDA's 100 real clone LDEMs; for each clone the observer's tile is replaced by the clone and the full horizon is recomputed (offline precomputation). Decision follows the same rule as ERR: nominal violation → RED; conservative = YELLOW if the 95% worst side of the clone ensemble violates a constraint (max-type p95, min-type p05); the number of clones meeting every constraint is also reported. Real example: Site01 centre 2027-11-14 → clone YELLOW (at +72 h 73/100 clones passed; p95 DTE outage 10.5 h > 8 h), the same class as ERR.
- **200 km reference rule (v1.3):** if the horizon was scanned shorter than 200 km (e.g. the 135 km quick mode) the decision is **at most YELLOW** (`radius_policy.code = REDUCED_HORIZON_RADIUS`, GREEN → YELLOW). Reason: a shorter scan takes the maximum over a subset of the reference terrain samples, so it can only lower the horizon — Sun/DTE visibility is optimistic. RED at 135 km therefore stays valid; YELLOW/GRAY may get worse at 200 km. Real run (2026-11-14, ERR k=1, 2026-12-17): the same request → GREEN at 200 km, YELLOW at 135 km (`logs/radius_policy_faz7.json`).
- ERR ±k is a sensitivity scenario, not a statistical confidence interval. No DEM clone data → `CLONE_NOT_PRECOMPUTED`.
- Slope: needs a DEM of ≤ 20 m; otherwise `SLOPE_UNKNOWN` → GRAY. Slope is not landing safety.
- The time series is sampled; transition moments are uncertain within a step. A 200 km scan is not proof of completeness; 0.1° sampling alone does not guarantee 2% accuracy.
- **DEM clone coverage:** only Site01 (100 PGDA clones) and only two precomputed coordinates — the Site01 tile centre (−89.46316, −137.48955) and the ridge test point (−89.4512, −137.1427), panel = antenna 4 m, 200 km. Other locations return `CLONE_NOT_PRECOMPUTED` / GRAY. The interface shows this list from `/health.clones.profile_sets`. Only the observer's 5 m tile is cloned; 80 m / 240 m stay nominal.
- **CLONE-01 deviation:** median of \|clone − surf\| / toterr is 0.726 versus the Gaussian 1σ expectation of 0.674 → the Site01 clones deviate from the surface **≈ 8% more** than the PGDA uncertainty map implies. Within the criterion (0.55–0.80); the clone spread is not a statistical confidence interval.
- **Not a NASA approval:** the validation results are the project team's own tests with NASA data; they are not approved or certified by NASA/JPL/GSFC/PGDA. Details and data versions: [`docs/VALIDATION.md`](docs/VALIDATION.md) (in Turkish).

### Decision classes on real data (design fixed before the run)

`python -m backend.scenario_search --days-step 3` → `logs/scenario_search_faz7.json`. Locations: 2 fixed test points + 5 site tile centres
(raster centres, not official landing sites); landings every 3 days from 2026-12-01 to 2027-11-26 (121 dates); 48 + 12 h, ERR k=1, 200 km,
4/4 m, +0/24/48/72 h. The design was fixed before the run; no threshold was tuned to produce a result.

| Constraint profile | RED | GREEN | YELLOW |
|---|---|---|---|
| form defaults (darkness ≤ 8 h, Sun ≥ 50%, DTE ≥ 50%, DTE outage ≤ 8 h) | 729 | 110 | **8** |
| Sun only (darkness ≤ 8 h, Sun ≥ 50%) | 513 | 314 | **20** |

- YELLOW appeared at the Site01, Site07, Site11 and Site23 centres (caused only by `MIN_ILLUMINATION`, `MAX_DARKNESS` or `MAX_DTE_GAP` on the conservative ERR +1σ horizon).
- Example verified through the real HTTP API and in the browser: **Site01 tile centre (−89.46316, −137.48955), 2027-11-14 00:00 UTC, ERR k=1, form defaults → YELLOW**:
  no nominal violation; in the +72 h scenario (2027-11-17 00:00 → 2027-11-19 12:00 UTC) the DTE outage is 7.0 h nominal and 11.5 h conservative > 8 h.
  The same request in nominal mode is GRAY (nominal alone never gives GREEN/YELLOW).
- EFFRES (effective resolution) reading: at the Site01 centre the EFFRES of the 240 m product is 16.9 m at the observer and a median of 24.5 m in the 30–200 km band
  → the LOLA measurement density is much finer than the 240 m grid; in that layer the pixel size limits the resolution. EFFRES is not a decision input.

## API

FastAPI, `http://127.0.0.1:8000/docs`. Long jobs return `202 + analysis_id`; status via `GET /analyses/{id}` (`queued | running | completed | partial | failed`).

| Endpoint | Note |
|---|---|
| `GET /health` | `status` ready/degraded = file presence; **v1.1 additions**: `layers` (dem/err/effres), `clone_profiles`, `limits`, `scientific_validation` |
| `GET /sites` | **v1.1**: `kind`, `effres_available`, `expected_file`, `expected_folder` (relative), `source_page`; **v1.2**: `region_name` (PGDA README), `footprint` (centre, latitude range and size from the raster's own georeferencing; `null` if the file is missing) |
| `POST /analyses` | 202; 503 `SPICE_MISSING`/`DEM_MISSING`; 429 `RATE_LIMITED`/`QUEUE_FULL`; **v1.1**: 422 responses carry `error.details[{field, message, type}]` (the input value is never echoed) |
| `GET /analyses/{id}` · `/horizon` · `/timeline` | 404 `ANALYSIS_NOT_FOUND`, 409 `HORIZON_NOT_READY`/`TIMELINE_NOT_READY` |
| `POST /compare` | `analysis_ids` (2–12), `priority`; 422 `INCOMPARABLE` (every parameter except location/dataset must be identical) |
| `POST /scenarios/shift` | 202; the parent's horizon is reused |
| `GET /validation` | **v1.1 new**: only the report of a real `python -m backend.validation` run; otherwise all `NOT_RUN`. **v1.2**: `SLOPE-01` added |
| horizon result (`/horizon`) | **v1.2**: `layer_resolution_m`, `excluded_layers`; cache schema 3 |
| mission result (`result.mission`) | **v1.3**: `radius_policy` {`code` `REDUCED_HORIZON_RADIUS`/`REFERENCE_RADIUS`, `radius_km`, `reference_radius_km`, `below_reference`, `status_before_policy`, `status_after_policy`, `capped`, `note`}; `radius_policy=` in the engineer explanation |
| horizon result (`/horizon`) | **v1.3**: `effective_resolution` {`units`, `note`, `layers`: per layer `status` (`OK`/`MISSING`/`NOT_PUBLISHED`), `pixel_m`, `band_km`, `at_observer_m`, `median_m`, `p90_m`, `max_m`}; not cached, not a decision input. In clone mode `uncertainty_mode: "clone"`, `clone_ensemble` (clone count, tile, profile key, p05–p95 band note) and `profiles.*.cautious/optimistic` = clone p95/p05 (display only) |
| `GET /health` | **v1.3**: `clones` {`sites`: per site `present/expected/complete`, `precomputed_profile_sets`, `profile_sets` (coordinate, observer height and radius where clone mode works; no file paths)}; the `clone_profiles` string is kept (`AVAILABLE`/`NOT_PRECOMPUTED`) |
| `POST /analyses` `uncertainty_mode: "clone"` | **v1.3**: if a precomputed real clone profile exists, metrics per clone; conservative variant = the p95-worst clone value per constraint (`metrics.method: clone_p95`), `variants.cautious.clone` {`n`, `pass_count`, `pass_fraction`, `fail_count_by_code`}; otherwise `CLONE_NOT_PRECOMPUTED` (GRAY) with a reason |

The v1.1 changes are **additive** (existing fields are kept) and are tested by `tests/test_api_v11.py`. Also: controlled localhost CORS, job timeout (`ANALYSIS_TIMEOUT`, 1800 s), pool created only inside `lifespan`.

## Tests and validation status

Full evidence of the scientific validation (criteria, real measurements, data versions, reproducible scenarios): **[`docs/VALIDATION.md`](docs/VALIDATION.md)** (in Turkish) — raw report `docs/validation/report_2026-11-14.json`, data versions `docs/validation/data_versions_2026-11-14.json`. These results are not a NASA approval or certification.

Latest real runs (Windows 11):

| Command | Result |
|---|---|
| `python -m pytest -q` | **97 passed** (2026-11-14; +4 real-data scenarios in `tests/test_realdata_scenarios.py`: ERR YELLOW 2027-11-14, nominal GRAY + 135 km cap, RED + slope 2026-12-26, clone YELLOW 73/100; *skipped* when the NASA files are absent) — the earlier 93: contract, SPICE UTC→ET, downloader 24 scenarios — including HTTP Range resume and a Windows manifest sharing violation, Windows spawn 7, API v1.1–v1.3, LOD/ERR layer consistency + EFFRES summary, clone engine 5, validation runner, Pareto regression, 200 km reference rule 8 |
| `python -m backend.verify_horizons` | `all_passed: true` — 6 Sun/Earth directions, max separation 4.14×10⁻⁷° (threshold 0.005°) |
| `python -m backend.validation` | **14 / 14 PASS** (A-04, V-01…V-10, SLOPE-01, EFFRES-01, CLONE-01; 2026-11-14T21:48Z, network included) → `data/validation/report.json` |
| `cd frontend; npx vitest run` | **156 passed** (2026-11-20). Covers: every component in English and Turkish; the decision, numbers, `POST /analyses` body and CSV export stay identical when the language changes; the Turkish decision sentence is identical to the backend `label`/`explanations.public`; the Public wizard and the Engineer cockpit send the **same `POST /analyses` body**; values are kept when switching mode; tile shortcuts, infographic geometry, MOON_ME `latrec` conversion; mode separation, Public/Engineer error UX, 135 km cap display, EFFRES text, clone variant table, telemetry, CSV export; UTC, client errors, form limits, deep-link URL contract, polling, component and chart contracts with the real-result fixture, Earth–Moon card |
| `npm run build` / `npm run lint` | success / 0 issues |
| `npm run e2e` | real backend + system Chrome (playwright-core): analysis, slip, /compare, Public↔Engineer, mobile 390 px (overflow 0), **axe-core 0 violations** (2026-11-20 run: TR + EN × Public/Engineer × 5 tabs = 20 scans; main flow with `?lang=tr`, then the decision is unchanged after switching to EN), console errors 0; also `UNCERTAINTY=err LANDING_DATE=2026-12-17` for the GREEN + Pareto flow, `UNCERTAINTY=err LANDING_DATE=2027-11-14` (Site01 centre) for **YELLOW**, `UNCERTAINTY=clone` for clone-mode YELLOW + slip |
| `npm run e2e:states` | 17/17 checks, **every state in both modes**: plain heading in Public mode with the code only inside the keyboard-opened “Technical details”, code shown directly in Engineer mode; focus moves on the SPICE error; axe 0 on error screens. Real `DEM_MISSING` (`lola_20m` not downloaded); labelled mocks for offline, `SPICE_MISSING`, `QUEUE_FULL`, `WORKER_UNAVAILABLE` + 409; invalid input blocked on the client |

Use of mocks: only in UI/client contract tests and downloader tests (HTTP mock + a tiny synthetic GeoTIFF inside `tmp_path`); each is labelled at the top of its file. UI component tests use a trimmed copy of a real API response (`frontend/src/test/fixtures/real_analysis_62e783c2.json`, `_provenance` field).

Scientific validation (`GET /validation`; PASS covers only the recorded cases):

| Test | Status | Evidence |
|---|---|---|
| A-04 / V-04 Horizons | PASS (limited) | **14 cases × 2 bodies = 28 directions**: 2026–2035, latitude −80.5…−89.98°, ±180° seam, observer 0–5 km, 29 February 2028; max separation **5.77×10⁻⁷°** (threshold 0.005°). Horizons centre `MEAN_ME`, sphere 1737.4; heights synthetic. Not proof for a full year / every location |
| V-01 source + coverage | PASS | de440s 1849–2150; moon PA bpc 1550–2650 ⊇ 2026–2035 |
| V-02 frame/coordinates | PASS | raster sphere 1737.4 km, pole = (0,0), +90°E → +x; PA→ME 103.9″ |
| V-03 UTC→ET | PASS | 4 dates, < 0.01 s against an independent TT−UTC = 69.184 s |
| V-05 135/200/250 km | PASS (7 locations) | 2 fixed points + 5 site tile centres: 200→250 km change **0°** at every location; **135→200 km: max 1.509° (Site11 centre, 13.9% of azimuths)**, Site07 1.149°, ridge point 0.762°, Site23 0.503° → a scan shorter than 200 km cannot give GREEN (v1.3 rule) |
| V-06 LOD/NoData | PASS | NaN propagation correct; median difference of 5 layer pairs −0.09…+0.63 m (criterion < 5 m; 80−240: −0.09 m, Site01−80: +0.09 m, Site04−80: −0.08 m); LOD 1 km → 5 m site, 10 km → 80 m, 100 km → 240 m |
| V-07 disk quadrature | PASS (flat + real curved horizon) | flat: max 0.0028 against the analytic circular segment; **real horizons**: 321 partial-occlusion samples (0.01 < f < 0.99) at 3 locations, max \|Δ\| **0.0060** against an independent 401×401 Cartesian reference, median 0.00055 (criterion < 0.01). Tests only the disk integral (same horizon interpolation), not horizon accuracy |
| V-08 ERR | PASS (consistency only) | **7 locations × k=1,2**: full coverage, conservative ≥ nominal ≥ optimistic, band(k=2) ≥ band(k=1) at every azimuth; k=1 max band 0.016° (−89.54/0) … 1.548° (Site23 centre, observer σ 0.597 m), Site01 centre 0.739°. Not a statistical validation |
| CLONE-01 DEM clone | PASS (consistency only) | Site01: all 100 clones on the `_surf` grid; median of \|clone − surf\| / toterr **0.726** (range 0.721–0.730; criterion 0.55–0.80; pure Gaussian expectation 0.674 → clone deviations ~8% larger than toterr implies); 2 precomputed sets, each 100/100 complete profiles (~201 s). Info: the clone p05–p95 spread lies inside the ERR k=2 band at 100% of azimuths (max 0.24° / 0.58° vs 0.56° / 1.42°). Site04/07/11 clones not downloaded. Not a statistical DEM validation |
| EFFRES-01 effective resolution | PASS | 240 m + 80 m EFFRES on the same grid as the DEM; ≥ 99% valid in the actual LOD band at 7 locations. Band medians 80 m (0–30 km) 15.5–18.6 m, 240 m (30–200 km) 24.5–27.0 m. Quality information only |
| V-09 constraint logic | PASS | hand-computed inputs |
| V-10 traceability | PASS | provenance fields in a real analysis; nominal → GRAY |
| SLOPE-01 5 m slope | PASS | our 5 m central-difference slope versus the **official PGDA `_slp.tif`** at 725 points on 5 tiles: median \|Δ\| 0.07° (criterion ≤ 2°); Site01 centre max 9.34° / mean 5.86°, Site04 tile centre ~31–34° (Shackleton inner wall). End to end: a real analysis with a slope constraint evaluated the slope from `site01_5m`; through the HTTP API err + ≤ 10° → GREEN, err + ≤ 5° → RED (`MAX_SLOPE`). Slope is not landing safety |

## Deep-link check

Checked on **2026-11-14** by reading each app's own JavaScript and opening two south-pole locations in headless Chrome. Coordinates are checked to be numeric/finite and in range; links use `target="_blank" rel="noopener noreferrer"`.

| Tool | URL scheme | Status |
|---|---|---|
| LROC QuickMap | `https://quickmap.lroc.im-ldi.com/?proj=27&center=<lon>,<lat>&resolution=20` — `proj=27` = *Stereographic (South Pole)* IAU2000:30120, `center` in degrees (east-positive −180…180), map products in Mean Earth. `quickmap.lroc.asu.edu` redirects to the new address with a 301. | **VERIFIED** — centred exactly on both sites |
| NASA Moon Trek | `https://trek.nasa.gov/moon/#v=0.1&x=<m>&y=<m>&z=8&p=urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120&d=&b=moon` — x/y in south polar stereographic metres (R = 1737400 m, lon_0 = 0; ρ = 2R·tan(45°+φ/2), x = ρ·sinλ, y = ρ·cosλ). The URN needs a double colon (`::`). | Format **VERIFIED**; centring on the coordinate **UNRELIABLE** (−89.45/−137.5: 4/4; −85.5/30: 2/7 — the others opened the general polar view). The interface says so explicitly. |

Neither tool officially documents these parameters; the links may break if the apps change. Contract tests: `frontend/src/lib/__tests__/deeplinks.test.ts`.

Earth–Moon education card sources: NASA NSSDC [Earth](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) and [Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) fact sheets (day 24.0000 h, obliquity 23.44°; synodic 29.53 d, sidereal rotation 655.72 h, night-time surface pressure 3×10⁻¹⁵ bar), [NASA SVS 5229](https://svs.gsfc.nasa.gov/5229/) (lunar axis 1.5°), [NASA Science — Shadows near the Moon's South Pole](https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/) (at the poles the Sun is at most 1.5° above/below the horizon).

## Backend bugs found and fixed during this work

| Bug | Effect | Fix + test |
|---|---|---|
| `str2et('YYYY-MM-DDTHH:MM:SS UTC')` → `SPICE(UNPARSEDTIME)` | **Every** analysis and A-04 failed | UTC format with a space; `tests/test_spice_time.py` |
| Horizons AIRLESS headers `Azimuth_/Elevation_(a-app)` | A-04 could not be parsed | regex for both formats; tested with the real header |
| `pareto_compare` deleted `costs` inside the loop | `/compare` → 500 with ≥ 2 GREEN/YELLOW candidates | relations computed first; `tests/test_pareto.py` |
| `geometry.observer_err_m` always `None` in ERR mode | incomplete provenance | σ of the conservative call reported; V-08 criterion; cache schema version |
| `MAX_CACHE_MB` defined but not enforced | unbounded cache | `prune_cache` + test |
| Native job stuck on timeout / shutdown | process could hang | `ANALYSIS_TIMEOUT` + worker terminate; spawn tests |

## Security and resource limits

- At most **2 `spawn` workers**, at most **6 pending/running jobs** (`429 QUEUE_FULL`), **5 analyses/min** per client (`429 RATE_LIMITED`; single instance, in memory — an internet-facing deployment needs a shared limit and a reverse proxy).
- The pool is created only inside FastAPI `lifespan` (not at import); a worker crash → `WORKER_UNAVAILABLE` + the pool is renewed; timeout → worker processes are terminated; a stuck job is not awaited at shutdown.
- `dataset_id` only from the catalogue; no user file paths are accepted; responses contain no traceback or absolute path; 422 details never echo the input value.
- Horizon cache in `data/cache/` (quota `MAX_CACHE_MB` = 1536, oldest entries removed). Analysis records live in memory only; the frontend never stores results permanently in the browser.
- CORS allows only explicit localhost origins; wildcards are rejected. The server binds to `127.0.0.1` by default.

## Known gaps

- 5 m tiles are limited to Site01/04/07/11/23; outside them slope stays `SLOPE_UNKNOWN` (contributes GRAY). The 20 m layer and Site06/20/Haworth/Shoemaker/DM2 are not downloaded.
- DEM clone mode works only for **Site01** (100 clones downloaded) and only for **precomputed** location/observer height/radius (currently the Site01 tile centre and the ridge test point, 4/4 m, 200 km). Other locations return `CLONE_NOT_PRECOMPUTED` / GRAY with a reason; precompute with `python -m backend.clone_engine --lat … --lon …` (~3.5 min). Only the observer's tile is cloned; 80/240 m stay nominal.
- The clone conservative rule (p95-worst clone per constraint) is a screening rule, not a certified confidence level.
- A-04 14 cases, V-05/V-08 7 locations, V-07 321 samples at 3 locations: wider coverage, but not proof for a full year / every location.
- Moon Trek centring on a coordinate is unreliable (caused by the external app).
- The rate limit is per process; analysis records are lost when the server restarts (the UI shows the 404 as "lost").

Detailed scientific validation evidence: [`docs/VALIDATION.md`](docs/VALIDATION.md) (in Turkish).
