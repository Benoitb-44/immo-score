# financial-calc — Simulateur financier immobilier locatif

Formules pures de simulation investissement locatif. Aucune dépendance Prisma / DB / fetch / Next.js — testable en isolation totale.

## Spec de référence

**MONET-v4-CALC** — https://app.notion.com/p/352407e4911981f98eb6d4e2e048ec01

## Utilisation

```typescript
import { calculateAll, type CalcInputs } from '@/lib/financial-calc';

const result = calculateAll({
  surface: 50,
  prix_m2: 3500,
  loyer_mensuel: 600,
  tf_an: 700,
  apport_pct: 0.10,
  duree_annees: 20,
  taux_nominal_an: 0.035,
  tmi: 0.30,
  regime: 'micro_foncier',
  type_bien: 'ancien',
});
// result.yield_brut, result.yield_net, result.cashflow_mensuel, ...
```

## Constantes (`financial-constants.ts`)

| Constante | Valeur | Source réglementaire |
|-----------|--------|----------------------|
| `FRAIS_NOTAIRE_ANCIEN` | 7.5% | notaires.fr 2024 |
| `FRAIS_NOTAIRE_NEUF` | 2.5% | notaires.fr 2024 (VEFA) |
| `TAUX_PS` | 17.2% | CGI art. 1600-0C |
| `ABATTEMENT_MICRO_FONCIER` | 30% | CGI art. 32 |
| `ABATTEMENT_LMNP_MICRO_BIC` | 50% | CGI art. 50-0 |
| `SEUIL_MICRO_FONCIER` | 15 000 €/an | CGI art. 32 |
| `PLAFOND_DEFICIT_FONCIER` | 10 700 €/an | CGI art. 156 |
| `TAUX_ASSURANCE_EMPRUNTEUR` | 0.3%/an | ACPR marché 2024 |
| `TAUX_VACANCE` | 1/12 (≈8.33%) | FNAIM 2023 |
| `TAUX_GESTION_LOCATIVE` | 8% | Usage marché |
| `TAUX_ENTRETIEN` | 0.5%/an | Provision prudente |
| `CHARGES_COPRO_M2_AN` | 20 €/m²/an | ANAH 2022 |

## Régimes fiscaux supportés

| `RegimeFiscal` | Assiette imposable |
|---|---|
| `micro_foncier` | `loyer_effectif × 70%` (abattement 30%) |
| `reel_foncier` | `loyer_effectif − charges − intérêts_moy_an` |
| `lmnp_micro_bic` | `loyer_effectif × 50%` (abattement 50%) |

L'impôt est calculé comme `max(0, revenu_imposable) × (tmi + 17.2%)`.

## Disclaimer méthodologique

- **Taxe foncière** : valeur `tf_an` représente la TF médiane de la commune (table `fiscalite`), pas la TF d'un bien spécifique.
- **Charges copropriété** : forfait 20 €/m²/an — ne s'applique pas aux maisons individuelles.
- **Intérêts déductibles (réel)** : calculés en moyenne sur la durée totale (`total_interets / duree_annees`), pas sur la première annuité.
- **LMNP** : micro-BIC uniquement. Le réel LMNP avec amortissement Robien/Borloo n'est pas implémenté.
- **Vacance locative** : taux forfaitaire national. Peut varier fortement selon le marché.
- **Les simulations sont indicatives** et ne remplacent pas un conseil fiscal ou financier personnalisé.
