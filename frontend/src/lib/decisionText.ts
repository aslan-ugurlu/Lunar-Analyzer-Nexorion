/**
 * Decision wording in the interface language.
 *
 * The backend's `mission.label` / `mission.explanations.public` are Turkish strings built in
 * backend/decision_engine.py from the decision status, the uncertainty mode and the 200-km
 * radius policy. The same wording is rebuilt here from those structured fields so English and
 * Turkish both work; the decision itself (status) always comes from the API unchanged.
 * `mission.explanations.engineer` is a language-neutral key=value dump and is shown verbatim.
 */
import type { Decision, Mission } from '../api/types';
import { defineStrings, pick } from '../i18n';

const DECISION_TEXT = defineStrings({
  en: {
    RED: 'Nominal mission constraints are not met',
    YELLOW_CLONE: 'Nominal passes; constraint violation on the 95% worst side of the DEM clone ensemble',
    YELLOW: 'Nominal passes; constraint violation in the conservative terrain scenario',
    GRAY: 'Data or uncertainty validation is insufficient',
    GREEN: 'Defined constraints are met in the nominal and conservative scenarios',
    capped: (radiusKm: string, referenceKm: string) =>
      `Nominal and conservative checks passed in the ${radiusKm} km quick scan; GREEN requires the ${referenceKm} km reference analysis`,
    notCertificate: 'This result is not a landing-safety certification.',
    belowReference: (radiusKm: string, referenceKm: string) =>
      `The horizon was scanned to ${radiusKm} km; the result could be worse in the ${referenceKm} km reference scan.`,
  },
  tr: {
    RED: 'Nominal görev kısıtları sağlanmıyor',
    YELLOW_CLONE: 'Nominal uygun; DEM clone topluluğunun %95 kötü tarafında kısıt ihlali var',
    YELLOW: 'Nominal uygun; ihtiyatlı arazi senaryosunda kısıt ihlali var',
    GRAY: 'Veri veya belirsizlik doğrulaması yetersiz',
    GREEN: 'Tanımlı kısıtlar nominal ve ihtiyatlı senaryolarda sağlanıyor',
    capped: (radiusKm: string, referenceKm: string) =>
      `Nominal ve ihtiyatlı kontroller ${radiusKm} km hızlı taramada geçti; GREEN için ${referenceKm} km referans analizi gerekli`,
    notCertificate: 'Bu sonuç iniş güvenliği sertifikası değildir.',
    belowReference: (radiusKm: string, referenceKm: string) =>
      `Ufuk ${radiusKm} km ile tarandı; ${referenceKm} km referans taramada sonuç daha kötü olabilir.`,
  },
});

/** Python's `{:g}` for the radii used here (200 → "200", 135.5 → "135.5"). */
function km(value: number): string {
  return String(Number(value.toPrecision(6)));
}

const DECISIONS: readonly Decision[] = ['GREEN', 'YELLOW', 'RED', 'GRAY'];

/** One-line decision label (mirrors backend `mission.label`). */
export function missionLabel(mission: Pick<Mission, 'status' | 'radius_policy'>, uncertaintyMode?: string): string {
  const t = pick(DECISION_TEXT);
  const policy = mission.radius_policy;
  if (policy?.capped) return t.capped(km(policy.radius_km), km(policy.reference_radius_km));
  const status: Decision = DECISIONS.includes(mission.status) ? mission.status : 'GRAY';
  if (status === 'YELLOW' && uncertaintyMode === 'clone') return t.YELLOW_CLONE;
  return t[status];
}

/** Plain-language explanation (mirrors backend `mission.explanations.public`). */
export function missionPublicExplanation(mission: Pick<Mission, 'status' | 'radius_policy'>, uncertaintyMode?: string): string {
  const t = pick(DECISION_TEXT);
  let text = `${missionLabel(mission, uncertaintyMode)}. ${t.notCertificate}`;
  const policy = mission.radius_policy;
  if (policy?.below_reference && !policy.capped && mission.status !== 'RED') {
    text += ` ${t.belowReference(km(policy.radius_km), km(policy.reference_radius_km))}`;
  }
  return text;
}
