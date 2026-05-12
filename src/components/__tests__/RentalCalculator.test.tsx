// @vitest-environment jsdom

import '@testing-library/jest-dom'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import RentalCalculator from '../RentalCalculator'
import type { LoyerCommuneData } from '@/lib/repositories/loyer.repository'
import type { TaxeFonciereData } from '@/lib/repositories/taxe-fonciere.repository'

// ─── Fixtures témoins SEO ─────────────────────────────────────────────────────

const COMMUNE_PARIS = { code_insee: '75056', nom: 'Paris', departement: '75', population: 2133111 }
const COMMUNE_LYON = { code_insee: '69123', nom: 'Lyon', departement: '69', population: 518635 }
const COMMUNE_BORDEAUX = { code_insee: '33063', nom: 'Bordeaux', departement: '33', population: 254436 }
const COMMUNE_TULLE = { code_insee: '19272', nom: 'Tulle', departement: '19', population: 14605 }
const COMMUNE_SAINT_JUVIN = { code_insee: '08383', nom: 'Saint-Juvin', departement: '08', population: 172 }

const LOYER_PARIS: LoyerCommuneData = {
  loyer_m2: 26.6, q1_m2: 23.2, q3_m2: 30.3, nb_obs: 3686,
  source: 'oll_paris', niveau: 'N1bis', millesime: 2024,
}
const LOYER_LYON: LoyerCommuneData = {
  loyer_m2: 13.95, q1_m2: 12.21, q3_m2: 16.07, nb_obs: 12221,
  source: 'oll_lyon', niveau: 'N1bis', millesime: 2024,
}
const LOYER_MARSEILLE: LoyerCommuneData = {
  loyer_m2: 13.0, q1_m2: 10.9, q3_m2: 15.6, nb_obs: 29778,
  source: 'oll_amp', niveau: 'N1bis', millesime: 2024,
}
const LOYER_BORDEAUX: LoyerCommuneData = {
  loyer_m2: 12.5, q1_m2: null, q3_m2: null, nb_obs: null,
  source: 'carte_loyers_anil', niveau: 'N1', millesime: 2023,
}
const LOYER_TULLE: LoyerCommuneData = {
  loyer_m2: 7.5, q1_m2: null, q3_m2: null, nb_obs: null,
  source: 'carte_loyers_anil', niveau: 'N1', millesime: 2023,
}

const TFB_NONE: TaxeFonciereData = {
  montant_tfb_total: null, taux_communal_pct: null, taux_epci_pct: null,
  source: 'ofgl-rei', secret_statistique: false, fallback_used: 'none',
}
const TFB_FALLBACK: TaxeFonciereData = {
  montant_tfb_total: 50_000_000, taux_communal_pct: null, taux_epci_pct: null,
  source: 'ofgl-rei', secret_statistique: true, fallback_used: 'departement_median',
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function parseYield(testId: string): number {
  const el = screen.getByTestId(testId)
  return parseFloat(el.textContent?.replace('%', '').trim() ?? 'NaN')
}

afterEach(() => {
  vi.useRealTimers()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 1 — Rendu sans crash pour les 5 témoins SEO
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 1 — rendu sans crash pour les 5 témoins SEO', () => {
  const WITNESSES = [
    { commune: COMMUNE_PARIS,       loyer: LOYER_PARIS,     prix: 10500 },
    { commune: COMMUNE_LYON,        loyer: LOYER_LYON,      prix: 5000  },
    { commune: COMMUNE_BORDEAUX,    loyer: LOYER_BORDEAUX,  prix: 4500  },
    { commune: COMMUNE_TULLE,       loyer: LOYER_TULLE,     prix: 1000  },
    { commune: COMMUNE_SAINT_JUVIN, loyer: null,            prix: null  },
  ] as const

  it('5 témoins SEO rendent sans erreur', () => {
    for (const { commune, loyer, prix } of WITNESSES) {
      const { unmount } = render(
        <RentalCalculator
          commune={commune}
          loyer={loyer}
          taxeFonciere={TFB_NONE}
          prixM2Dvf={prix}
          surfaceMoyFilosofi={null}
          nbLogementsFilosofi={null}
        />,
      )
      expect(screen.getByTestId('rental-calculator')).toBeInTheDocument()
      unmount()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2 — yield_brut Paris ∈ [2.5, 3.5] avec inputs default
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 2 — yield_brut Paris ∈ [2.5, 3.5]', () => {
  it('Paris 26.6 €/m² loyer, 10 500 €/m² prix → yield_brut ≈ 3.04 %', () => {
    render(
      <RentalCalculator
        commune={COMMUNE_PARIS}
        loyer={LOYER_PARIS}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={10500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const yb = parseYield('yield-brut')
    expect(yb).toBeGreaterThanOrEqual(2.5)
    expect(yb).toBeLessThanOrEqual(3.5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 3 — yield_net Paris < yield_brut Paris
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 3 — yield_net Paris < yield_brut Paris', () => {
  it('TFB + charges + fiscalité réduisent le rendement net', () => {
    render(
      <RentalCalculator
        commune={COMMUNE_PARIS}
        loyer={LOYER_PARIS}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={10500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const yb = parseYield('yield-brut')
    const yn = parseYield('yield-net')
    expect(yn).toBeLessThan(yb)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4 — yield_brut Lyon ∈ [3.2, 5]
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 4 — yield_brut Lyon ∈ [3.2, 5]', () => {
  it('Lyon 13.95 €/m² loyer, 5 000 €/m² prix → yield_brut ≈ 3.35 %', () => {
    render(
      <RentalCalculator
        commune={COMMUNE_LYON}
        loyer={LOYER_LYON}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={5000}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const yb = parseYield('yield-brut')
    expect(yb).toBeGreaterThanOrEqual(3.2)
    expect(yb).toBeLessThanOrEqual(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 5 — yield_brut Marseille ∈ [4.5, 6]
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 5 — yield_brut Marseille ∈ [4.5, 6]', () => {
  it('Marseille 13.0 €/m² loyer, 3 200 €/m² prix → yield_brut ≈ 4.88 %', () => {
    render(
      <RentalCalculator
        commune={{ code_insee: '13055', nom: 'Marseille', departement: '13', population: 870321 }}
        loyer={LOYER_MARSEILLE}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={3200}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const yb = parseYield('yield-brut')
    expect(yb).toBeGreaterThanOrEqual(4.5)
    expect(yb).toBeLessThanOrEqual(6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 6 — changement de surface recalcule les outputs
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 6 — changement de surface recalcule les outputs', () => {
  it('surface 70 → 100 m² modifie la mensualité et le cash-flow', async () => {
    vi.useFakeTimers()

    render(
      <RentalCalculator
        commune={COMMUNE_PARIS}
        loyer={LOYER_PARIS}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={10500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )

    // Lire la mensualité initiale (surface 70m² par défaut)
    const mensualiteEl = screen.getByText(/Mensualité crédit/i).closest('div')!
    const mensualiteInitiale = mensualiteEl.querySelector('.font-mono.text-2xl')?.textContent ?? ''

    // Changer la surface à 100m²
    const selectSurface = screen.getByRole('combobox', { name: /Surface/i })
    fireEvent.change(selectSurface, { target: { value: '100' } })

    // Avancer de 400ms pour déclencher le debounce
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    const mensualiteApres = mensualiteEl.querySelector('.font-mono.text-2xl')?.textContent ?? ''
    expect(mensualiteApres).not.toBe(mensualiteInitiale)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 7 — changement de régime fiscal impacte yield_net mais pas yield_brut
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 7 — régime fiscal modifie yield_net pas yield_brut', () => {
  it('passage Réel → LMNP micro-BIC : yield_brut stable, yield_net change', async () => {
    vi.useFakeTimers()

    render(
      <RentalCalculator
        commune={COMMUNE_BORDEAUX}
        loyer={LOYER_BORDEAUX}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={4500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )

    const ybInitial = parseYield('yield-brut')
    const ynInitial = parseYield('yield-net')

    // Changer le régime
    const selectRegime = screen.getByRole('combobox', { name: /Régime fiscal/i })
    fireEvent.change(selectRegime, { target: { value: 'lmnp_micro_bic' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    const ybApres = parseYield('yield-brut')
    const ynApres = parseYield('yield-net')

    // yield_brut ne dépend pas du régime fiscal
    expect(ybApres).toBeCloseTo(ybInitial, 2)
    // yield_net change avec l'abattement LMNP (50% vs charges réelles)
    expect(ynApres).not.toBeCloseTo(ynInitial, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 8 — badge "Loyer observé OLL" pour Paris (N1bis, source oll_paris)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 8 — badge niveau loyer Paris N1bis', () => {
  it('affiche "Loyer observé OLL" pour source oll_paris / niveau N1bis', () => {
    render(
      <RentalCalculator
        commune={COMMUNE_PARIS}
        loyer={LOYER_PARIS}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={10500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const badge = screen.getByTestId('loyer-badge')
    expect(badge.textContent).toContain('Loyer observé OLL')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 9 — badge "TFB estimé" pour fallback_used !== 'none'
// ═══════════════════════════════════════════════════════════════════════════════

describe('Test 9 — badge TFB estimé affiché pour fallback', () => {
  it('affiche le badge TFB estimé quand fallback_used = departement_median', () => {
    render(
      <RentalCalculator
        commune={COMMUNE_SAINT_JUVIN}
        loyer={null}
        taxeFonciere={TFB_FALLBACK}
        prixM2Dvf={1200}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    const badge = screen.getByTestId('tfb-badge')
    expect(badge.textContent).toContain('TFB estimé')
    expect(badge.textContent).toContain('donnée commune non publiée')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Test 10 — cash-flow < 0 → texte rouge + label "Effort d'épargne mensuel"
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 10 — cash-flow négatif → effort d'épargne mensuel", () => {
  it("Paris : cashflow négatif affiche le label et la couleur rouge", () => {
    render(
      <RentalCalculator
        commune={COMMUNE_PARIS}
        loyer={LOYER_PARIS}
        taxeFonciere={TFB_NONE}
        prixM2Dvf={10500}
        surfaceMoyFilosofi={null}
        nbLogementsFilosofi={null}
      />,
    )
    // Paris avec 10 500 €/m² et taux 3.25% produit un cashflow très négatif
    const label = screen.getByText(/effort d.épargne mensuel/i)
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('text-red-600')
  })
})
