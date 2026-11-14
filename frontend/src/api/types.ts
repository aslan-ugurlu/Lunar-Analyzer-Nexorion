/**
 * Types derived by hand from backend/main.py, backend/decision_engine.py and
 * backend/terrain_engine.py (API v1.1). Optional fields are optional because the
 * backend omits them on GRAY / partial paths; always check before use.
 */

export type Decision = 'GREEN' | 'YELLOW' | 'RED' | 'GRAY';
export type JobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type UncertaintyMode = 'nominal' | 'err' | 'clone';
export type Priority = 'balanced' | 'sun' | 'comms' | 'resilience';

/* ---------------- GET /health ---------------- */
export interface LayerPresence {
  dem: boolean;
  err: boolean;
  effres: boolean;
}

export interface Health {
  status: 'ready' | 'degraded';
  spice_files_present: boolean;
  kernels: Record<string, boolean>;
  datasets: Record<string, boolean>;
  note: string;
  jobs_pending: number;
  layers?: Record<string, LayerPresence>;
  clone_profiles?: string;
  /** v1.3: real PGDA clone files per site tile and number of precomputed profile sets. */
  clones?: {
    sites: Record<string, { site_tile: string; present: number; expected: number; complete: boolean }>;
    precomputed_profile_sets: number;
  };
  limits?: {
    max_workers: number;
    max_pending: number;
    analyses_per_minute_per_client: number;
    analysis_timeout_s: number;
  };
  scientific_validation?: string;
}

/* ---------------- GET /sites ---------------- */
export interface SiteLayer {
  id: string;
  resolution_m: number;
  kind?: 'global' | 'regional' | 'site';
  available: boolean;
  uncertainty_err_available: boolean;
  effres_available?: boolean;
  expected_file?: string;
  expected_folder?: string;
  source_page?: string | null;
  /** Region name from the PGDA LOLA_5mpp README (names a DEM tile, not a landing site). */
  region_name?: string | null;
  /** Extent computed from the raster's own georeferencing; null when the file is absent. */
  footprint?: {
    center: { lat: number; lon: number };
    lat_range: [number, number];
    width_km: number;
    height_km: number;
    contains_pole: boolean;
    pixel_size_m: number;
  } | null;
  note: string;
}

export interface SitesResponse {
  sites: SiteLayer[];
  site_coordinates: string;
}

/* ---------------- POST /analyses (AnalysisInput) ---------------- */
export interface Constraints {
  max_darkness_hours?: number | null;
  min_sun_fraction?: number | null;
  min_dte_fraction?: number | null;
  max_dte_gap_hours?: number | null;
  max_slope_deg?: number | null;
  slope_footprint_radius_m?: number;
}

export interface AnalysisInput {
  dataset_id: string;
  latitude: number;
  longitude: number;
  landing_utc: string; // ISO-8601 with Z
  duration_hours: number;
  buffer_hours: number;
  step_minutes: number;
  horizon_radius_km: number;
  sun_observer_height_m: number;
  earth_observer_height_m: number;
  uncertainty_mode: UncertaintyMode;
  err_k: number;
  dark_fraction_threshold: number;
  shifts_hours: number[];
  constraints: Constraints;
}

export interface QueuedResponse {
  analysis_id: string;
  status: JobStatus;
  request_id: string;
}

/* ---------------- Analysis results ---------------- */
export interface BodyPosition {
  az_deg: number;
  el_deg: number;
  angular_radius_deg: number;
  distance_km: number;
}

export interface TimelinePoint {
  utc: string;
  sun: BodyPosition;
  earth: BodyPosition;
  sun_visible_fraction: number | null;
  dte_visible: boolean | null;
}

export interface ValidMetrics {
  valid: true;
  mean_sun_visible_fraction: number;
  dte_visible_fraction: number;
  max_continuous_darkness_s: number;
  max_continuous_dte_gap_s: number;
  max_disk_integration_difference: number;
  darkness_interval: [number, number] | null;
  dte_gap_interval: [number, number] | null;
  sun_visible_fraction: number[];
  earth_visible: boolean[];
  time_resolution_minutes: number;
}

export interface InvalidMetrics {
  valid: false;
  reason?: string;
  sun_visible_fraction?: (number | null)[];
  earth_visible?: (boolean | null)[];
}

export type Metrics = ValidMetrics | InvalidMetrics;

export interface Violation {
  code: 'MAX_DARKNESS' | 'MIN_ILLUMINATION' | 'MIN_DTE' | 'MAX_DTE_GAP' | 'MAX_SLOPE' | string;
  observed: number;
  limit: number;
  excess: number;
  unit: 's' | 'fraction' | 'deg' | string;
}

export interface Unresolved {
  code: 'INCOMPLETE_VISIBILITY' | 'SLOPE_UNKNOWN' | string;
  message?: string | null;
}

export interface Variant {
  metrics: Metrics;
  violations: Violation[];
  unknown: Unresolved[];
}

export interface Scenario {
  shift_hours: number;
  start_utc: string;
  end_utc: string;
  variants: Partial<Record<'nominal' | 'cautious', Variant & { clone?: CloneSummary }>>;
  timeline: TimelinePoint[];
}

export interface Slope {
  slope_max_deg: number | null;
  slope_mean_deg?: number;
  status: string;
  source?: string;
  footprint_radius_m?: number;
  sampling_interval_m?: number;
}

export interface Mission {
  status: Decision;
  label?: string;
  reason?: string;
  quality?: string;
  explanations?: { public: string; engineer: string };
  slope?: Slope;
  scenarios: Scenario[];
  nominal_violations?: Violation[];
  cautious_violations?: Violation[];
  unresolved?: Unresolved[];
  disclaimers?: string[];
  /** v1.3: 200-km reference radius rule (shorter scans never end GREEN). Absent on older results. */
  radius_policy?: RadiusPolicy;
}

export interface CloneSummary {
  n: number;
  pass_count: number | null;
  pass_fraction: number | null;
  invalid?: number;
  fail_count_by_code?: Record<string, number>;
  percentile?: number;
}

export interface EffresLayer {
  status: 'OK' | 'MISSING' | 'NOT_PUBLISHED' | 'NO_VALID_PIXELS' | 'UNREADABLE' | string;
  pixel_m: number;
  band_km: [number, number];
  file?: string;
  expected_file?: string;
  at_observer_m?: number | null;
  median_m?: number | null;
  p90_m?: number | null;
  max_m?: number | null;
  valid_fraction?: number;
  n_samples?: number;
  note?: string;
}

export interface RadiusPolicy {
  code: 'REDUCED_HORIZON_RADIUS' | 'REFERENCE_RADIUS' | string;
  radius_km: number;
  reference_radius_km: number;
  below_reference: boolean;
  status_before_policy: Decision;
  status_after_policy: Decision;
  capped: boolean;
  note: string;
}

export interface HorizonProfile {
  nominal: (number | null)[];
  coverage: number[];
  cautious?: (number | null)[];
  optimistic?: (number | null)[];
}

export interface Horizon {
  azimuth_deg: number[];
  profiles: { sun: HorizonProfile; earth: HorizonProfile };
  geometry: {
    observer_dem_m: number;
    observer_err_m: number | null;
    observer_height_m: { sun: number; earth: number };
  };
  sources: Record<string, string>;
  /** v1.2: resolution of every layer actually used (metres). */
  layer_resolution_m?: Record<string, number>;
  /** v1.2: layers present on disk but not used (e.g. no ERR in ERR mode), with reason. */
  excluded_layers?: Record<string, string>;
  /** v1.3: PGDA EFFRES (effective resolution, m) per used layer; quality metadata only. */
  effective_resolution?: {
    units: 'm';
    note: string;
    layers: Record<string, EffresLayer>;
  };
  reference_radius_km: number;
  selected_dataset_id: string;
  uncertainty_mode: 'nominal' | 'err' | 'clone';
  k: number | null;
  cache_key: string;
  /** v1.3: present only in clone mode (band = per-azimuth p05–p95 of real PGDA clone horizons). */
  clone_ensemble?: {
    n_clones: number;
    site_tile: string;
    cloned_layer: string;
    profile_key: string;
    created_utc: string;
    source: string;
    percentile: number;
    band: string;
    observer_dem_m_range: [number, number];
    band_complete: boolean;
    note: string;
  };
  status: 'complete' | 'partial';
  notes: string[];
}

/** Worker result stored in the job; three shapes exist in main.py. */
export interface WorkerResult {
  status: Decision;
  error_code?: 'DEM_MISSING' | 'TERRAIN_UNAVAILABLE' | 'CLONE_NOT_PRECOMPUTED' | string;
  reason?: string;
  mission?: Mission;
  horizon?: Horizon;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  result: WorkerResult | null;
  error: 'WORKER_UNAVAILABLE' | 'CALCULATION_ERROR' | 'ANALYSIS_TIMEOUT' | 'CANCELLED' | string | null;
  parent_id: string | null;
}

/* ---------------- GET /analyses/{id}/timeline ---------------- */
export interface TimelineResponse {
  status: Decision;
  scenarios: Pick<Scenario, 'shift_hours' | 'start_utc' | 'end_utc' | 'timeline'>[];
}

/* ---------------- POST /compare ---------------- */
export interface RankedCandidate {
  id: string;
  status: 'GREEN' | 'YELLOW';
  metrics: {
    mean_sun_visible_fraction: number;
    max_continuous_darkness_s: number;
    dte_visible_fraction: number;
    max_continuous_dte_gap_s: number;
  };
  dominated_by: string[];
}

export interface CompareResponse {
  priority: Priority;
  green: RankedCandidate[];
  yellow: RankedCandidate[];
  excluded: { id: string; status: Decision }[];
  note: string;
}

/* ---------------- GET /validation ---------------- */
export type ValidationStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'BLOCKED';

export interface ValidationEntry {
  status: ValidationStatus;
  summary: string;
  evidence: unknown;
  run_utc: string | null;
}

export interface ValidationResponse {
  tests: Record<string, ValidationEntry>;
  source: string | null;
  generated_utc: string | null;
  note: string;
}

/* ---------------- Errors ---------------- */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: { field: string | null; message: string; type?: string }[];
  };
}
