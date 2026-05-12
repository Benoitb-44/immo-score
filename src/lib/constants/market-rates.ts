/**
 * Taux marché crédit immobilier France — utilisé par <RentalCalculator>
 * SOURCE: Observatoire Crédit Logement/CSA (T1 2026) + barèmes courtiers mai 2026
 * REFRESH: ticket INFRA-MARKET-RATES-REFRESH (P3 trimestriel, prochain 12/08/2026)
 * Voir spec Orchestrateur 12/05/2026 + page Data Scientist Notion
 */
export const DEFAULT_INTEREST_RATE = 3.25 // pct, durée 20 ans, médiane mai 2026
export const DEFAULT_RATE_REFRESHED_AT = '2026-05-12'
export const DEFAULT_RATE_SOURCE = 'Observatoire Crédit Logement/CSA'
export const INTEREST_RATE_OPTIONS = [2.85, 3.00, 3.25, 3.50, 3.75, 4.00, 4.25] as const

export const DEFAULT_DOWN_PAYMENT = 10 // pct
export const DOWN_PAYMENT_OPTIONS = [0, 5, 10, 15, 20, 30] as const

export const DEFAULT_LOAN_DURATION = 20 // années
export const LOAN_DURATION_OPTIONS = [15, 20, 25, 30] as const

export const DEFAULT_SURFACE = 70 // m²
export const SURFACE_OPTIONS = [30, 50, 70, 100, 120] as const

export const DEFAULT_TAX_REGIME = 'reel_foncier' as const
export const TAX_REGIMES = ['micro_foncier', 'reel_foncier', 'lmnp_micro_bic'] as const
export type TaxRegime = (typeof TAX_REGIMES)[number]

// Hypothèses cachées (affichées dans le collapse <Hypothèses>)
export const VACANCY_RATE = 1 / 12 // 1 mois/an = 4.17% — aligné sur TAUX_VACANCE financial-constants.ts
export const CHARGES_RATE = 0.10 // 10% du loyer annuel (gestion + entretien, indicatif UI)
