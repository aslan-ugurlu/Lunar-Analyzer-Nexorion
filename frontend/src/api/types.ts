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
  variants: Partial<Record<'nominal' | 'cautious', Variant>>;
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
  reference_radius_km: number;
  selected_dataset_id: string;
  uncertainty_mode: 'nominal' | 'err';
  k: number | null;
  cache_key: string;
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
