'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  calculateAll,
  type CalcInputs,
  type RegimeFiscal,
} from '@/lib/financial-calc'
import {
  DEFAULT_INTEREST_RATE,
  DEFAULT_RATE_REFRESHED_AT,
  DEFAULT_RATE_SOURCE,
  DEFAULT_DOWN_PAYMENT,
  DEFAULT_LOAN_DURATION,
  DEFAULT_SURFACE,
  DEFAULT_TAX_REGIME,
  INTEREST_RATE_OPTIONS,
  DOWN_PAYMENT_OPTIONS,
  LOAN_DURATION_OPTIONS,
  SURFACE_OPTIONS,
  TAX_REGIMES,
  VACANCY_RATE,
  CHARGES_RATE,
} from '@/lib/constants/market-rates'
import type { LoyerCommuneData } from '@/lib/repositories/loyer.repository'
import type { TaxeFonciereData } from '@/lib/repositories/taxe-fonciere.repository'
import { estimateTfbForBien as estimateTfbFilosofi } from '@/lib/repositories/taxe-fonciere.repository'
import type { RpLogementDto } from '@/lib/repositories/rp-logement'
import { estimateTfbForBien as estimateTfbRp } from '@/lib/financial-calc'

interface Props {
  commune: {
    code_insee: string
    nom: string
    departement: string
    population: number | null
  }
  loyer: LoyerCommuneData | null
  taxeFonciere: TaxeFonciereData | null
  prixM2Dvf: number | null
  surfaceMoyFilosofi: number | null
  nbLogementsFilosofi: number | null
  rpLogement: RpLogementDto | null
}

const REGIME_LABELS: Record<RegimeFiscal, string> = {
  micro_foncier: 'Micro-foncier (abat. 30%)',
  reel_foncier: 'Réel foncier',
  lmnp_micro_bic: 'LMNP micro-BIC (abat. 50%)',
}

const SOURCE_LABELS: Record<string, string> = {
  oll_paris: 'Loyer observé OLL',
  oll_lyon: 'Loyer observé OLL',
  oll_amp: 'Loyer observé OLL',
  carte_loyers_anil: 'Loyer ANIL/Cerema',
  dvf_inverse: 'Loyer estimé DVF',
  regional_median: 'Loyer médian régional',
  national_median: 'Loyer médian national',
}

function getLoyerLabel(source: string, niveau: string): string {
  if (niveau === 'N1bis' && source.startsWith('oll_')) return 'Loyer observé OLL'
  return SOURCE_LABELS[source] ?? 'Loyer estimé'
}

function fmtEur(n: number): string {
  return Math.round(n).toLocaleString('fr-FR') + ' €'
}

function fmtPct(n: number): string {
  return n.toFixed(2) + ' %'
}

function computeInitialTfAn(
  taxeFonciere: TaxeFonciereData | null,
  rpLogement: RpLogementDto | null,
  nbLogements: number | null,
  surfaceMoy: number | null,
  surface: number,
): number {
  if (!taxeFonciere) return 0

  if (rpLogement && taxeFonciere.montant_tfb_total != null && rpLogement.nb_logements_total > 0) {
    const tfbMoyParLogement = taxeFonciere.montant_tfb_total / rpLogement.nb_logements_total
    const { tfb } = estimateTfbRp({
      surfaceUserM2: surface,
      tfbMoyenParLogementCommune: tfbMoyParLogement,
      nbPiecesMoyCommune: rpLogement.nb_pieces_moy,
    })
    return tfb != null ? Math.round(tfb) : 0
  }

  const estim = estimateTfbFilosofi(
    taxeFonciere,
    { nb_logements: nbLogements, surface_moy: surfaceMoy },
    surface,
  )
  return estim != null ? Math.round(estim) : 0
}

export default function RentalCalculator({
  commune,
  loyer,
  taxeFonciere,
  prixM2Dvf,
  surfaceMoyFilosofi,
  nbLogementsFilosofi,
  rpLogement,
}: Props) {
  const initSurface = Math.round(surfaceMoyFilosofi ?? DEFAULT_SURFACE)
  const initTfAn = computeInitialTfAn(
    taxeFonciere,
    rpLogement,
    nbLogementsFilosofi,
    surfaceMoyFilosofi,
    initSurface,
  )

  // ── 8 états d'entrée ─────────────────────────────────────────────────────────
  const [surface, setSurface] = useState(initSurface)
  const [prixM2, setPrixM2] = useState(prixM2Dvf ?? 3000)
  const [loyerM2, setLoyerM2] = useState(loyer?.loyer_m2 ?? 12)
  const [apportPct, setApportPct] = useState(DEFAULT_DOWN_PAYMENT)
  const [tauxNominal, setTauxNominal] = useState(DEFAULT_INTEREST_RATE)
  const [dureeAnnees, setDureeAnnees] = useState(DEFAULT_LOAN_DURATION)
  const [regime, setRegime] = useState<RegimeFiscal>(DEFAULT_TAX_REGIME)
  const [tfAn, setTfAn] = useState(initTfAn)

  // ── DEV warning si taux non rafraîchi depuis > 90j (side-effect → useEffect) ─
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const daysSince =
        (Date.now() - new Date(DEFAULT_RATE_REFRESHED_AT).getTime()) / 86_400_000
      if (daysSince > 90) {
        console.warn(
          `[RentalCalculator] Taux marché non rafraîchi depuis ${Math.round(daysSince)} jours (${DEFAULT_RATE_REFRESHED_AT}). Ticket INFRA-MARKET-RATES-REFRESH.`,
        )
      }
    }
  }, [])

  // ── Debounce 300ms : les calculs déclenchés après stabilité des entrées ──────
  const [debouncedInputs, setDebouncedInputs] = useState<CalcInputs>(() => ({
    surface: initSurface,
    prix_m2: prixM2Dvf ?? 3000,
    loyer_mensuel: Math.max(0, (loyer?.loyer_m2 ?? 12) * initSurface),
    tf_an: initTfAn,
    apport_pct: DEFAULT_DOWN_PAYMENT / 100,
    duree_annees: DEFAULT_LOAN_DURATION,
    taux_nominal_an: DEFAULT_INTEREST_RATE / 100,
    tmi: 0.30,
    regime: DEFAULT_TAX_REGIME,
    type_bien: 'ancien',
  }))

  useEffect(() => {
    const loyerMensuel = Math.max(0, loyerM2 * surface)
    const t = setTimeout(() => {
      setDebouncedInputs({
        surface: Math.max(1, surface),
        prix_m2: Math.max(1, prixM2),
        loyer_mensuel: loyerMensuel,
        tf_an: Math.max(0, tfAn),
        apport_pct: apportPct / 100,
        duree_annees: dureeAnnees,
        taux_nominal_an: tauxNominal / 100,
        tmi: 0.30,
        regime,
        type_bien: 'ancien',
      })
    }, 300)
    return () => clearTimeout(t)
  }, [surface, prixM2, loyerM2, apportPct, tauxNominal, dureeAnnees, regime, tfAn])

  // ── 5 useMemo pour outputs ───────────────────────────────────────────────────
  const calcResult = useMemo(() => {
    try {
      return calculateAll(debouncedInputs)
    } catch {
      return null
    }
  }, [debouncedInputs])

  const mensualiteCredit = useMemo(
    () => calcResult?.mensualite_credit ?? null,
    [calcResult],
  )
  const loyerMensuelEff = useMemo(
    () => (calcResult ? calcResult.loyer_an_effectif / 12 : null),
    [calcResult],
  )
  const yieldBrut = useMemo(() => calcResult?.yield_brut ?? null, [calcResult])
  const yieldNet = useMemo(() => calcResult?.yield_net ?? null, [calcResult])
  const cashflow = useMemo(() => calcResult?.cashflow_mensuel ?? null, [calcResult])

  const isYieldExtreme = yieldBrut != null && (yieldBrut < 2 || yieldBrut > 12)
  const isCashflowNeg = cashflow != null && cashflow < 0
  const tfbEstimated = taxeFonciere?.fallback_used !== 'none'

  // ── Rendu ────────────────────────────────────────────────────────────────────
  return (
    <div className="border-2 border-ink bg-paper mt-8" data-testid="rental-calculator">
      {/* Header */}
      <div className="border-b-2 border-ink px-6 pt-6 pb-4">
        <h2 className="text-2xl font-bold font-display text-ink">
          CALCULATEUR D&apos;INVESTISSEMENT LOCATIF
        </h2>
        <p className="font-mono text-xs text-ink-muted mt-1">
          {commune.nom} ({commune.departement}) — simulation investisseur, données open data
        </p>
      </div>

      <div className="px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Colonne gauche : Inputs ── */}
        <div className="flex flex-col gap-5">

          {/* Surface */}
          <div>
            <label htmlFor="rc-surface" className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Surface (m²)
            </label>
            <select
              id="rc-surface"
              value={surface}
              onChange={e => setSurface(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            >
              {SURFACE_OPTIONS.map(s => (
                <option key={s} value={s}>{s} m²</option>
              ))}
              {!(SURFACE_OPTIONS as readonly number[]).includes(surface) && (
                <option value={surface}>{surface} m² (estimé commune)</option>
              )}
            </select>
          </div>

          {/* Prix m² */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Prix d&apos;achat (€/m²)
            </label>
            <input
              type="number"
              value={prixM2}
              min={100}
              max={30000}
              step={100}
              onChange={e => setPrixM2(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            />
            {prixM2Dvf == null && (
              <p className="font-mono text-[10px] text-ink-muted mt-1">
                Valeur par défaut — données DVF insuffisantes pour cette commune
              </p>
            )}
          </div>

          {/* Loyer m² */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Loyer (€/m²)
            </label>
            <input
              type="number"
              value={loyerM2}
              min={1}
              max={100}
              step={0.5}
              onChange={e => setLoyerM2(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            />
            {loyer && (
              <span
                className="inline-block mt-1 font-mono text-[10px] border-2 border-ink px-2 py-0.5"
                data-testid="loyer-badge"
              >
                {getLoyerLabel(loyer.source, loyer.niveau)} · {loyer.millesime}
              </span>
            )}
          </div>

          {/* Apport */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Apport (%)
            </label>
            <select
              value={apportPct}
              onChange={e => setApportPct(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            >
              {DOWN_PAYMENT_OPTIONS.map(p => (
                <option key={p} value={p}>{p} %</option>
              ))}
            </select>
          </div>

          {/* Taux */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Taux d&apos;intérêt (%)
            </label>
            <select
              value={tauxNominal}
              onChange={e => setTauxNominal(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            >
              {INTEREST_RATE_OPTIONS.map(t => (
                <option key={t} value={t}>{t.toFixed(2)} %</option>
              ))}
            </select>
            <p className="font-mono text-[10px] text-ink-muted mt-1">
              ⓘ Source : {DEFAULT_RATE_SOURCE} — {DEFAULT_RATE_REFRESHED_AT}
            </p>
          </div>

          {/* Durée */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Durée du crédit (ans)
            </label>
            <select
              value={dureeAnnees}
              onChange={e => setDureeAnnees(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            >
              {LOAN_DURATION_OPTIONS.map(d => (
                <option key={d} value={d}>{d} ans</option>
              ))}
            </select>
          </div>

          {/* Régime fiscal */}
          <div>
            <label htmlFor="rc-regime" className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Régime fiscal
            </label>
            <select
              id="rc-regime"
              value={regime}
              onChange={e => setRegime(e.target.value as RegimeFiscal)}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            >
              {TAX_REGIMES.map(r => (
                <option key={r} value={r}>{REGIME_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {/* TFB */}
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-ink-muted block mb-1">
              Taxe foncière estimée (€/an)
            </label>
            <input
              type="number"
              value={tfAn}
              min={0}
              max={99999}
              step={50}
              onChange={e => setTfAn(Number(e.target.value))}
              className="w-full border-2 border-ink px-3 py-2 font-mono text-sm bg-paper focus:outline-none"
            />
            {tfbEstimated && (
              <span
                className="inline-block mt-1 font-mono text-[10px] border-2 border-ink px-2 py-0.5"
                data-testid="tfb-badge"
              >
                TFB estimé — donnée commune non publiée
              </span>
            )}
            {rpLogement ? (
              <p className="font-mono text-[10px] text-ink-muted mt-1" data-testid="tfb-rp-badge">
                TFB : estimation INSEE RP 2022, ratio moyen national 23 m²/pièce. Précision limitée Paris (~17) / zones rurales (~25).
              </p>
            ) : (
              <p className="font-mono text-[10px] text-ink-muted mt-1" data-testid="tfb-rp-null-badge">
                Données INSEE millésime 2022 — TFB non disponible
              </p>
            )}
            {!taxeFonciere && (
              <p className="font-mono text-[10px] text-ink-muted mt-1">
                Données OFGL non disponibles pour cette commune
              </p>
            )}
          </div>
        </div>

        {/* ── Colonne droite : Outputs ── */}
        <div className="flex flex-col gap-5">

          {/* Mensualité crédit */}
          <div className="border-2 border-ink p-4">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-muted mb-2">
              Mensualité crédit
            </p>
            <p className="font-mono text-2xl font-bold text-ink tabular-nums">
              {mensualiteCredit != null ? fmtEur(mensualiteCredit) : '—'}
            </p>
          </div>

          {/* Loyer mensuel effectif */}
          <div className="border-2 border-ink p-4">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-muted mb-2">
              Loyer mensuel (hors vacance)
            </p>
            <p className="font-mono text-2xl font-bold text-ink tabular-nums">
              {loyerMensuelEff != null ? fmtEur(loyerMensuelEff) : '—'}
            </p>
            <p className="font-mono text-[10px] text-ink-muted mt-1">
              Vacance {(VACANCY_RATE * 100).toFixed(1)} % déduite ({Math.round(VACANCY_RATE * 12)} mois/an)
            </p>
          </div>

          {/* Yield brut */}
          <div className="border-2 border-ink p-4">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-muted mb-2">
              Rendement brut
            </p>
            <div className="flex items-center gap-3">
              <p
                className="font-mono text-2xl font-bold tabular-nums text-ink"
                data-testid="yield-brut"
              >
                {yieldBrut != null ? fmtPct(yieldBrut) : '—'}
              </p>
              {isYieldExtreme && (
                <span className="font-mono text-xs border-2 border-amber-500 text-amber-500 px-2 py-1">
                  ⚠ Rendement atypique
                </span>
              )}
            </div>
          </div>

          {/* Yield net */}
          <div className="border-2 border-ink p-4">
            <p className="font-mono text-xs uppercase tracking-wide text-ink-muted mb-2">
              Rendement net (charges + fiscalité)
            </p>
            <p
              className="font-mono text-2xl font-bold tabular-nums text-ink"
              data-testid="yield-net"
            >
              {yieldNet != null ? fmtPct(yieldNet) : '—'}
            </p>
            <p className="font-mono text-[10px] text-ink-muted mt-1">
              TMI 30 % · régime {REGIME_LABELS[regime]}
            </p>
          </div>

          {/* Cash-flow */}
          <div className="border-2 border-ink p-4">
            <p
              className={`font-mono text-xs uppercase tracking-wide mb-2 ${
                isCashflowNeg ? 'text-red-600' : 'text-ink-muted'
              }`}
            >
              {isCashflowNeg ? "Effort d'épargne mensuel" : 'Cash-flow mensuel'}
            </p>
            <p
              className={`font-mono text-2xl font-bold tabular-nums ${
                isCashflowNeg ? 'text-red-600' : 'text-ink'
              }`}
              data-testid="cashflow"
            >
              {cashflow != null ? fmtEur(Math.abs(cashflow)) : '—'}
            </p>
            {cashflow != null && (
              <p className="font-mono text-[10px] text-ink-muted mt-1">
                {cashflow >= 0
                  ? 'Loyer couvre crédit + charges + fiscalité'
                  : 'Loyer insuffisant — effort mensuel à prévoir'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Collapse Hypothèses */}
      <div className="border-t-2 border-ink px-6 py-4">
        <details>
          <summary className="font-mono text-xs cursor-pointer text-ink-muted hover:text-ink select-none">
            ▸ Hypothèses de calcul
          </summary>
          <ul className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-ink-muted">
            <li>Frais de notaire : 7.5 % (bien ancien)</li>
            <li>Vacance locative : {(VACANCY_RATE * 100).toFixed(1)} % ({Math.round(VACANCY_RATE * 12)} mois/an — FNAIM 2023)</li>
            <li>Charges indicatives : {(CHARGES_RATE * 100).toFixed(0)} % du loyer annuel</li>
            <li>Assurance emprunteur : 0.30 %/an du capital (ACPR 2024)</li>
            <li>Charges copropriété : 20 €/m²/an (ANAH 2022)</li>
            <li>Entretien/réparations : 0.50 %/an du prix d&apos;achat</li>
            <li>Gestion locative : 8 % des loyers perçus</li>
            <li>TMI appliquée : 30 % (tranche investisseur type)</li>
            <li>Taux crédit : {DEFAULT_INTEREST_RATE.toFixed(2)} % — {DEFAULT_RATE_SOURCE} ({DEFAULT_RATE_REFRESHED_AT})</li>
          </ul>
        </details>
      </div>

      {/* Footer sources */}
      <div className="border-t-2 border-ink px-6 py-3 flex flex-wrap gap-1 items-center">
        <span className="font-mono text-[10px] font-bold text-ink shrink-0">SOURCES</span>
        <span className="font-mono text-[10px] text-ink-muted">
          · DVF · OLL/ANIL · OFGL REI 2024 · INSEE RP 2022 · Filosofi 2021 · {DEFAULT_RATE_SOURCE} mai 2026
        </span>
      </div>
    </div>
  )
}
