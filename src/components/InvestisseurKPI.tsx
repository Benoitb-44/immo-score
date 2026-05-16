import type { InvestisseurKPIData } from '@/lib/repositories/investisseur.repository'

const LOYER_SOURCE_LABELS: Record<string, string> = {
  oll_paris: 'OLAP Paris',
  oll_lyon: 'OLL Lyon',
  oll_amp: 'OLL AMP',
  carte_loyers_anil: 'ANIL/Cerema',
  dvf_inverse: 'Estimé DVF',
  regional_median: 'Médiane régionale',
  national_median: 'Médiane nationale',
}

function yieldColor(pct: number): string {
  if (pct >= 8) return 'text-score-high'
  if (pct >= 5) return 'text-score-mid'
  return 'text-ink'
}

function yieldBadge(pct: number): string {
  if (pct >= 10) return 'Extrême'
  if (pct >= 8) return 'Élevé'
  if (pct >= 6) return 'Bon'
  if (pct >= 4) return 'Moyen'
  return 'Faible'
}

interface Props {
  kpi: InvestisseurKPIData
}

export default function InvestisseurKPI({ kpi }: Props) {
  const loyerSourceLabel = kpi.loyer_source ? (LOYER_SOURCE_LABELS[kpi.loyer_source] ?? kpi.loyer_source) : null

  return (
    <div className="border-2 border-ink bg-paper">
      {/* ── Header ── */}
      <div className="border-b-2 border-ink px-5 py-3 bg-ink">
        <p className="font-mono text-xs text-paper tracking-widest uppercase">
          KPI Investisseur — Données d&apos;État (DVF · ANIL/OLL · OFGL)
        </p>
      </div>

      {/* ── Grid 2×2 ── */}
      <div className="grid grid-cols-2 divide-x-2 divide-y-2 divide-ink">

        {/* KPI 1 — Yield brut */}
        <div className="p-5 flex flex-col gap-1">
          <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
            Yield brut indicatif
          </p>
          {kpi.yield_brut != null ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-display text-4xl font-bold tabular-nums leading-none ${yieldColor(kpi.yield_brut)}`}>
                  {kpi.yield_brut.toFixed(1)}
                </span>
                <span className="font-mono text-base text-ink-muted">%</span>
              </div>
              <p className="font-mono text-[10px] text-ink-muted">
                {yieldBadge(kpi.yield_brut)}
                {kpi.rang_national != null && (
                  <span className="ml-2">· Rang national #{kpi.rang_national}</span>
                )}
              </p>
            </>
          ) : (
            <p className="font-mono text-sm text-ink-muted">—</p>
          )}
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Loyer annuel / prix DVF · brut, charges non déduites
          </p>
        </div>

        {/* KPI 2 — Prix DVF */}
        <div className="p-5 flex flex-col gap-1">
          <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
            Prix médian DVF
          </p>
          {kpi.prix_m2_median != null ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tabular-nums leading-none text-ink">
                  {kpi.prix_m2_median.toLocaleString('fr-FR')}
                </span>
                <span className="font-mono text-base text-ink-muted">€/m²</span>
              </div>
              <p className="font-mono text-[10px] text-ink-muted">Médiane toutes transactions 2020-2024</p>
            </>
          ) : (
            <p className="font-mono text-sm text-ink-muted">—</p>
          )}
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Source DVF — data.gouv.fr
          </p>
        </div>

        {/* KPI 3 — Loyer médian */}
        <div className="p-5 flex flex-col gap-1">
          <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
            Loyer médian
          </p>
          {kpi.loyer_m2 != null ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tabular-nums leading-none text-ink">
                  {kpi.loyer_m2.toFixed(1)}
                </span>
                <span className="font-mono text-base text-ink-muted">€/m²</span>
              </div>
              {kpi.loyer_niveau && (
                <p className="font-mono text-[10px] text-ink-muted">
                  Niveau {kpi.loyer_niveau}
                  {kpi.rang_departement != null && kpi.nb_communes_dept != null && (
                    <span className="ml-2">· #{kpi.rang_departement}/{kpi.nb_communes_dept} dans le dép.</span>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="font-mono text-sm text-ink-muted">—</p>
          )}
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Source : {loyerSourceLabel ?? '—'}
          </p>
        </div>

        {/* KPI 4 — Taxe foncière */}
        <div className="p-5 flex flex-col gap-1">
          <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
            Taxe foncière
          </p>
          {kpi.taxe_fonciere_total != null ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tabular-nums leading-none text-ink">
                  {kpi.taxe_fonciere_total.toLocaleString('fr-FR')}
                </span>
                <span className="font-mono text-base text-ink-muted">€/an</span>
              </div>
              {kpi.taux_tf_pct != null && (
                <p className="font-mono text-[10px] text-ink-muted">
                  Taux communal {kpi.taux_tf_pct.toFixed(2)} %
                </p>
              )}
            </>
          ) : (
            <p className="font-mono text-sm text-ink-muted">—</p>
          )}
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Source OFGL REI 2024 — montant moyen commune
          </p>
        </div>
      </div>

      {/* ── Note méthodologique ── */}
      <div className="border-t-2 border-ink px-5 py-3 bg-paper-soft">
        <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
          Yield brut = loyer annuel médian / prix médian DVF. Brut avant charges, vacance et impôts.{' '}
          <a href="/methodologie#sources" className="underline hover:text-ink transition-colors">
            Voir la méthode complète
          </a>
        </p>
      </div>
    </div>
  )
}
