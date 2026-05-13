import { describe, it, expect } from 'vitest';
import {
  calculateAcquisition,
  calculateCredit,
  calculateRevenuLocatif,
  calculateCharges,
  calculateFiscalite,
  calculateAll,
  estimateTfbForBien,
  SURFACE_PAR_PIECE_M2,
  type CalcInputs,
  type RegimeFiscal,
} from '../financial-calc';

// ─── Base inputs (params fixes spec MONET-v4-CALC) ────────────────────────
const BASE: CalcInputs = {
  surface: 50,
  prix_m2: 3000,
  loyer_mensuel: 600,
  tf_an: 700,
  apport_pct: 0.10,
  duree_annees: 20,
  taux_nominal_an: 0.035,
  tmi: 0.30,
  regime: 'micro_foncier',
  type_bien: 'ancien',
};

// ─── Witness fixtures (données synthétiques — réelles via DATA-v4-LOY) ─────
const COMMUNES: Array<{ nom: string; prix_m2: number; loyer_mensuel: number; tf_an: number }> = [
  { nom: 'Paris',       prix_m2: 10500, loyer_mensuel: 850, tf_an: 1200 },
  { nom: 'Lyon',        prix_m2:  5000, loyer_mensuel: 650, tf_an:  900 },
  { nom: 'Bordeaux',    prix_m2:  4500, loyer_mensuel: 600, tf_an:  800 },
  { nom: 'Marseille',   prix_m2:  3500, loyer_mensuel: 550, tf_an:  700 },
  { nom: 'Nantes',      prix_m2:  4000, loyer_mensuel: 625, tf_an:  750 },
  { nom: 'Rennes',      prix_m2:  3800, loyer_mensuel: 600, tf_an:  700 },
  { nom: 'Lille',       prix_m2:  3200, loyer_mensuel: 575, tf_an:  650 },
  { nom: 'Strasbourg',  prix_m2:  3500, loyer_mensuel: 575, tf_an:  680 },
  { nom: 'Montluçon',   prix_m2:   900, loyer_mensuel: 320, tf_an:  350 },
  // Tulle: fixture synthétique high-yield — loyer délibérément élevé pour démontrer LMNP > réel
  { nom: 'Tulle',       prix_m2:  1000, loyer_mensuel: 700, tf_an:  150 },
];

const DEUX_REGIMES: RegimeFiscal[] = ['micro_foncier', 'reel_foncier'];

// ─── Helpers ──────────────────────────────────────────────────────────────

function assertAllFinite(result: Record<string, number>, label: string) {
  for (const [key, val] of Object.entries(result)) {
    expect(isFinite(val), `${label}: ${key} should be finite`).toBe(true);
    expect(isNaN(val),    `${label}: ${key} should not be NaN`).toBe(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tests unitaires — une formule à la fois
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateAcquisition', () => {
  it('calcule les montants acquisition pour un bien ancien', () => {
    const r = calculateAcquisition(BASE);
    // prix = 50 × 3000 = 150 000, frais = 11 250, cout_total = 161 250
    expect(r.prix_acquisition).toBe(50 * 3000);
    expect(r.frais_notaire).toBeCloseTo(150_000 * 0.075, 2);
    // apport_pct sur cout_total (convention FR)
    expect(r.apport).toBeCloseTo(161_250 * 0.10, 2);         // 16 125
    expect(r.capital_emprunte).toBeCloseTo(161_250 * 0.90, 2); // 145 125
  });

  it('applique les frais réduits pour un bien neuf', () => {
    const r = calculateAcquisition({ ...BASE, type_bien: 'neuf' });
    const cout = 150_000 + 150_000 * 0.025; // 153 750
    expect(r.frais_notaire).toBeCloseTo(150_000 * 0.025, 2);
    expect(r.capital_emprunte).toBeCloseTo(cout * 0.90, 2);
  });

  it('capital_emprunte = 0 quand apport_pct = 1.0', () => {
    const r = calculateAcquisition({ ...BASE, apport_pct: 1.0 });
    expect(r.capital_emprunte).toBe(0);
  });
});

describe('calculateCredit', () => {
  it('calcule la mensualite annuite constante (taux 3.5%, 20 ans)', () => {
    const r = calculateCredit(BASE);
    const tm = 0.035 / 12;
    const n = 240;
    // capital = cout_total × 0.90 = 161 250 × 0.90 = 145 125
    const capital = (150_000 + 150_000 * 0.075) * 0.90;
    const expected = (capital * tm) / (1 - Math.pow(1 + tm, -n));
    expect(r.mensualite_credit).toBeCloseTo(expected, 2);
    expect(r.total_interets).toBeGreaterThan(0);
    expect(r.interets_moy_an).toBeCloseTo(r.total_interets / 20, 2);
  });

  it('taux 0% : pas d-interets, mensualite = capital / n', () => {
    const r = calculateCredit({ ...BASE, taux_nominal_an: 0 });
    const { capital_emprunte } = calculateAcquisition(BASE);
    expect(r.total_interets).toBeCloseTo(0, 6);
    expect(r.mensualite_credit).toBeCloseTo(capital_emprunte / 240, 2);
  });

  it('apport 100% : capital = 0, mensualite = 0', () => {
    const r = calculateCredit({ ...BASE, apport_pct: 1.0 });
    expect(r.mensualite_credit).toBe(0);
    expect(r.total_interets).toBe(0);
    expect(r.interets_moy_an).toBe(0);
  });
});

describe('calculateRevenuLocatif', () => {
  it('calcule loyers brut/effectif et yield_brut', () => {
    const r = calculateRevenuLocatif(BASE);
    expect(r.loyer_an_brut).toBe(600 * 12);              // 7 200
    expect(r.loyer_an_effectif).toBeCloseTo(7200 * (11 / 12), 2); // 6 600
    expect(r.yield_brut).toBeCloseTo((7200 / 150_000) * 100, 4);  // 4.8%
  });

  it('loyer_mensuel 0 : tous les revenus à zéro', () => {
    const r = calculateRevenuLocatif({ ...BASE, loyer_mensuel: 0 });
    expect(r.loyer_an_brut).toBe(0);
    expect(r.loyer_an_effectif).toBe(0);
    expect(r.yield_brut).toBe(0);
  });
});

describe('calculateCharges', () => {
  it('calcule le total des charges proprietaire-bailleur', () => {
    const r = calculateCharges(BASE);
    // Recompute expected using same formula
    const { capital_emprunte, prix_acquisition } = calculateAcquisition(BASE);
    const loyer_eff = 600 * 12 * (11 / 12);
    const expected =
      BASE.tf_an +
      capital_emprunte * 0.003 +
      50 * 20 +
      loyer_eff * 0.08 +
      prix_acquisition * 0.005;
    expect(r.charges_tot).toBeCloseTo(expected, 2);
  });

  it('toutes les composantes sont positives ou nulles', () => {
    const r = calculateCharges(BASE);
    expect(r.tf).toBeGreaterThanOrEqual(0);
    expect(r.assurance_emprunteur).toBeGreaterThanOrEqual(0);
    expect(r.charges_copro).toBeGreaterThan(0);
    expect(r.frais_gestion).toBeGreaterThanOrEqual(0);
    expect(r.entretien).toBeGreaterThan(0);
  });
});

describe('calculateFiscalite', () => {
  it('micro_foncier : abattement 30% appliqué', () => {
    const r = calculateFiscalite({ ...BASE, regime: 'micro_foncier' });
    const loyer_eff = 600 * 12 * (11 / 12);
    expect(r.revenu_imposable).toBeCloseTo(loyer_eff * 0.70, 2);
    expect(r.impot_an).toBeCloseTo(r.revenu_imposable * (0.30 + 0.172), 2);
  });

  it('lmnp_micro_bic : abattement 50% appliqué', () => {
    const r = calculateFiscalite({ ...BASE, regime: 'lmnp_micro_bic' });
    const loyer_eff = 600 * 12 * (11 / 12);
    expect(r.revenu_imposable).toBeCloseTo(loyer_eff * 0.50, 2);
  });

  it('reel_foncier : revenu = loyer_eff - charges - intérêts', () => {
    const r = calculateFiscalite({ ...BASE, regime: 'reel_foncier' });
    const { loyer_an_effectif } = calculateRevenuLocatif(BASE);
    const { charges_tot } = calculateCharges(BASE);
    const { interets_moy_an } = calculateCredit(BASE);
    expect(r.revenu_imposable).toBeCloseTo(
      loyer_an_effectif - charges_tot - interets_moy_an, 2
    );
  });

  it('impot_an >= 0 (pas de credit impot)', () => {
    const r = calculateFiscalite(BASE);
    expect(r.impot_an).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Witnesses — 10 communes × 2 régimes (20 cas)
// ═══════════════════════════════════════════════════════════════════════════

describe('Witnesses — 10 communes × 2 régimes', () => {
  for (const commune of COMMUNES) {
    for (const regime of DEUX_REGIMES) {
      it(`${commune.nom} × ${regime} : no NaN/Infinity/aberrant`, () => {
        const inputs: CalcInputs = {
          ...BASE,
          prix_m2: commune.prix_m2,
          loyer_mensuel: commune.loyer_mensuel,
          tf_an: commune.tf_an,
          regime,
        };
        const r = calculateAll(inputs);

        assertAllFinite(r as unknown as Record<string, number>, `${commune.nom}/${regime}`);
        expect(r.yield_brut).toBeGreaterThanOrEqual(0);
        expect(r.impot_an).toBeGreaterThanOrEqual(0);
        expect(r.effort_epargne_mensuel).toBeGreaterThanOrEqual(0);
        // yield_net toujours < yield_brut (vacance + charges + impôts)
        expect(r.yield_net).toBeLessThan(r.yield_brut);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Tests de cohérence
// ═══════════════════════════════════════════════════════════════════════════

describe('Cohérence : yield_net < yield_brut systématique', () => {
  it('vrai pour tous les régimes avec la base', () => {
    for (const regime of ['micro_foncier', 'reel_foncier', 'lmnp_micro_bic'] as RegimeFiscal[]) {
      const r = calculateAll({ ...BASE, regime });
      expect(r.yield_net).toBeLessThan(r.yield_brut);
    }
  });
});

describe('Tulle witness — LMNP micro-BIC > réel foncier (high yield)', () => {
  // Fixture synthétique : loyer élevé pour démontrer la supériorité LMNP
  // quand charges + intérêts < 50% × loyer_effectif
  const tulle: CalcInputs = {
    surface: 50,
    prix_m2: 1000,
    loyer_mensuel: 700,
    tf_an: 150,
    apport_pct: 0.10,
    duree_annees: 20,
    taux_nominal_an: 0.035,
    tmi: 0.30,
    regime: 'lmnp_micro_bic',
    type_bien: 'ancien',
  };

  it('LMNP micro-BIC : impot_an < réel foncier', () => {
    const lmnp = calculateFiscalite(tulle);
    const reel = calculateFiscalite({ ...tulle, regime: 'reel_foncier' });
    expect(lmnp.impot_an).toBeLessThan(reel.impot_an);
  });

  it('LMNP micro-BIC : yield_net > réel foncier', () => {
    const lmnp = calculateAll(tulle);
    const reel = calculateAll({ ...tulle, regime: 'reel_foncier' });
    expect(lmnp.yield_net).toBeGreaterThan(reel.yield_net);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Déficit foncier
// ═══════════════════════════════════════════════════════════════════════════

describe('Régime réel — déficit foncier', () => {
  it('revenu_imposable < 0 et impot = 0 quand loyer très bas', () => {
    // Loyer très faible, charges importantes → déficit certain
    const inputs: CalcInputs = {
      ...BASE,
      regime: 'reel_foncier',
      loyer_mensuel: 80,
      tf_an: 800,
    };
    const r = calculateFiscalite(inputs);
    expect(r.revenu_imposable).toBeLessThan(0);
    expect(r.impot_an).toBe(0);
  });

  it('Paris réel foncier : déficit foncier (fort emprunt, faible rendement)', () => {
    const paris: CalcInputs = {
      ...BASE,
      regime: 'reel_foncier',
      prix_m2: 10500,
      loyer_mensuel: 850,
      tf_an: 1200,
    };
    const r = calculateFiscalite(paris);
    // Paris : intérêts > 10 000 €/an → déficit structurel
    expect(r.revenu_imposable).toBeLessThan(0);
    expect(r.impot_an).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('apport_pct 0% : levier total, mensualité maximale, résultat fini', () => {
    const r = calculateAll({ ...BASE, apport_pct: 0 });
    expect(isFinite(r.mensualite_credit)).toBe(true);
    expect(r.mensualite_credit).toBeGreaterThan(0);
    expect(isFinite(r.yield_brut)).toBe(true);
  });

  it('apport_pct 100% : achat comptant, mensualite = 0, cashflow positif', () => {
    const r = calculateAll({ ...BASE, apport_pct: 1.0 });
    expect(r.mensualite_credit).toBe(0);
    expect(r.effort_epargne_mensuel).toBeGreaterThanOrEqual(0);
    expect(isFinite(r.yield_net)).toBe(true);
  });

  it('taux_nominal_an 0% : pas d-interets, mensualite = capital / 240', () => {
    const c = calculateCredit({ ...BASE, taux_nominal_an: 0 });
    expect(c.total_interets).toBeCloseTo(0, 5);
    expect(isFinite(c.mensualite_credit)).toBe(true);
    const r = calculateAll({ ...BASE, taux_nominal_an: 0 });
    assertAllFinite(r as unknown as Record<string, number>, 'taux_0');
  });

  it('loyer_mensuel 0 : yields à zéro, impôt à zéro', () => {
    const r = calculateAll({ ...BASE, loyer_mensuel: 0 });
    expect(r.yield_brut).toBe(0);
    expect(r.loyer_an_brut).toBe(0);
    expect(r.loyer_an_effectif).toBe(0);
    expect(r.impot_an).toBe(0);
    expect(r.effort_epargne_mensuel).toBeGreaterThan(0); // credit toujours du
  });

  it('prix_m2 ≤ 0 : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, prix_m2: 0 })).toThrow('prix_m2');
    expect(() => calculateAll({ ...BASE, prix_m2: -100 })).toThrow('prix_m2');
  });

  it('surface ≤ 0 : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, surface: 0 })).toThrow('surface');
  });

  it('apport_pct hors [0,1] : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, apport_pct: 1.5 })).toThrow('apport_pct');
    expect(() => calculateAll({ ...BASE, apport_pct: -0.1 })).toThrow('apport_pct');
  });

  it('loyer_mensuel negatif : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, loyer_mensuel: -1 })).toThrow('loyer_mensuel');
  });

  it('tf_an negatif : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, tf_an: -100 })).toThrow('tf_an');
  });

  it('duree_annees <= 0 : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, duree_annees: 0 })).toThrow('duree_annees');
  });

  it('taux_nominal_an negatif : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, taux_nominal_an: -0.01 })).toThrow('taux_nominal_an');
  });

  it('tmi hors [0,1] : erreur explicite', () => {
    expect(() => calculateAll({ ...BASE, tmi: -0.1 })).toThrow('tmi');
    expect(() => calculateAll({ ...BASE, tmi: 1.1 })).toThrow('tmi');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Witnesses OFGL 2024 — TF réelle calibrée (DATA-v4-TF)
//    tf_an = montant_tfb_total estimé pour un bien 50m² (commune + EPCI)
//    Sources : probe OFGL 2024 (taux voté × base cadastrale 50m²)
//      Paris     : taux 20.50%, tf_an ≈  820 € (base ~4 000 €)
//      Lyon      : taux 32.44% (commune 31.89% + GFP 0.55%), tf_an ≈ 1 460 €
//      Bordeaux  : taux 48.48%, tf_an ≈ 1 212 € (base ~2 500 €)
//      Marseille : taux 44.54%, tf_an ≈ 1 247 € (base ~2 800 €)
// ═══════════════════════════════════════════════════════════════════════════

const OFGL_FIXTURES = [
  { nom: 'Paris',     prix_m2: 10_500, loyer_mensuel: 850, tf_an:   820 },
  { nom: 'Lyon',      prix_m2:  5_000, loyer_mensuel: 650, tf_an: 1_460 },
  { nom: 'Bordeaux',  prix_m2:  4_500, loyer_mensuel: 600, tf_an: 1_212 },
  { nom: 'Marseille', prix_m2:  3_500, loyer_mensuel: 550, tf_an: 1_247 },
] as const;

describe('Witnesses OFGL 2024 — TF réelle calibrée (DATA-v4-TF)', () => {
  it('yield_net < yield_brut pour les 4 métropoles', () => {
    for (const f of OFGL_FIXTURES) {
      const r = calculateAll({ ...BASE, prix_m2: f.prix_m2, loyer_mensuel: f.loyer_mensuel, tf_an: f.tf_an });
      expect(r.yield_net, `${f.nom}: yield_net doit être < yield_brut`).toBeLessThan(r.yield_brut);
    }
  });

  it('écart yield_brut − yield_net ≥ impact direct TF (tf_an / prix_acquisition × 100)', () => {
    // La TF seule réduit le rendement net d-au moins sa contribution directe
    for (const f of OFGL_FIXTURES) {
      const r = calculateAll({ ...BASE, prix_m2: f.prix_m2, loyer_mensuel: f.loyer_mensuel, tf_an: f.tf_an });
      const prix_acq = f.prix_m2 * BASE.surface;
      const tf_direct_pct = (f.tf_an / prix_acq) * 100;
      const ecart = r.yield_brut - r.yield_net;
      expect(ecart, `${f.nom}: écart ≥ impact TF direct`).toBeGreaterThanOrEqual(tf_direct_pct);
    }
  });

  it('Bordeaux (taux 48%) pèse plus que Paris (taux 20%) sur le même surface 50m²', () => {
    // TF burden = tf_an / prix_acquisition — doit être plus élevé à Bordeaux
    const paris     = OFGL_FIXTURES.find(f => f.nom === 'Paris')!;
    const bordeaux  = OFGL_FIXTURES.find(f => f.nom === 'Bordeaux')!;
    const burden_paris    = paris.tf_an    / (paris.prix_m2    * BASE.surface);
    const burden_bordeaux = bordeaux.tf_an / (bordeaux.prix_m2 * BASE.surface);
    expect(burden_bordeaux).toBeGreaterThan(burden_paris);
    // Les deux yields_net restent finis
    const rP = calculateAll({ ...BASE, prix_m2: paris.prix_m2,    loyer_mensuel: paris.loyer_mensuel,    tf_an: paris.tf_an });
    const rB = calculateAll({ ...BASE, prix_m2: bordeaux.prix_m2, loyer_mensuel: bordeaux.loyer_mensuel, tf_an: bordeaux.tf_an });
    expect(isFinite(rP.yield_net)).toBe(true);
    expect(isFinite(rB.yield_net)).toBe(true);
  });

  it('tous les résultats sont finis (no NaN/Infinity avec TF réelle OFGL)', () => {
    for (const f of OFGL_FIXTURES) {
      const r = calculateAll({ ...BASE, prix_m2: f.prix_m2, loyer_mensuel: f.loyer_mensuel, tf_an: f.tf_an });
      assertAllFinite(r as unknown as Record<string, number>, `OFGL/${f.nom}`);
    }
  });
});

// ─── estimateTfbForBien (RP Logement) ────────────────────────────────────────

describe('estimateTfbForBien — constante SURFACE_PAR_PIECE_M2', () => {
  it('vaut 23.3 m²/pièce (INSEE Enquête Logement 2020)', () => {
    expect(SURFACE_PAR_PIECE_M2).toBe(23.3);
  });
});

describe('estimateTfbForBien — témoin Paris 50m² [1500, 2500 €]', () => {
  it('Paris : tfbMoy=2000, nbPiecesMoy=2.6 → résultat dans [1500, 2500]', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 2000,
      nbPiecesMoyCommune: 2.6,
    });
    expect(tfb).not.toBeNull();
    expect(tfb!).toBeGreaterThanOrEqual(1500);
    expect(tfb!).toBeLessThanOrEqual(2500);
  });
});

describe('estimateTfbForBien — témoin Lyon 50m² [1200, 1800 €]', () => {
  it('Lyon : tfbMoy=1700, nbPiecesMoy=2.8 → résultat dans [1200, 1800]', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 1700,
      nbPiecesMoyCommune: 2.8,
    });
    expect(tfb).not.toBeNull();
    expect(tfb!).toBeGreaterThanOrEqual(1200);
    expect(tfb!).toBeLessThanOrEqual(1800);
  });
});

describe('estimateTfbForBien — témoin Bordeaux 50m² [800, 1200 €]', () => {
  it('Bordeaux : tfbMoy=1200, nbPiecesMoy=2.8 → résultat dans [800, 1200]', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 1200,
      nbPiecesMoyCommune: 2.8,
    });
    expect(tfb).not.toBeNull();
    expect(tfb!).toBeGreaterThanOrEqual(800);
    expect(tfb!).toBeLessThanOrEqual(1200);
  });
});

describe('estimateTfbForBien — témoin Tulle 50m² [400, 600 €]', () => {
  it('Tulle : tfbMoy=650, nbPiecesMoy=3.2 → résultat dans [400, 600]', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 650,
      nbPiecesMoyCommune: 3.2,
    });
    expect(tfb).not.toBeNull();
    expect(tfb!).toBeGreaterThanOrEqual(400);
    expect(tfb!).toBeLessThanOrEqual(600);
  });
});

describe('estimateTfbForBien — témoin Saint-Pierremont 50m² [150, 300 €]', () => {
  it('Saint-Pierremont : tfbMoy=300, nbPiecesMoy=3.5 → résultat dans [150, 300]', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 300,
      nbPiecesMoyCommune: 3.5,
    });
    expect(tfb).not.toBeNull();
    expect(tfb!).toBeGreaterThanOrEqual(150);
    expect(tfb!).toBeLessThanOrEqual(300);
  });
});

describe('estimateTfbForBien — proportionnalité surface', () => {
  it('doubler la surface double la TFB estimée', () => {
    const base = { tfbMoyenParLogementCommune: 1000, nbPiecesMoyCommune: 3.0 };
    const r50 = estimateTfbForBien({ surfaceUserM2: 50, ...base });
    const r100 = estimateTfbForBien({ surfaceUserM2: 100, ...base });
    expect(r50.tfb).not.toBeNull();
    expect(r100.tfb).not.toBeNull();
    expect(r100.tfb!).toBeCloseTo(r50.tfb! * 2, 5);
  });
});

describe('estimateTfbForBien — guards surface <= 0', () => {
  it('retourne tfb=null si surface <= 0', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 0,
      tfbMoyenParLogementCommune: 1000,
      nbPiecesMoyCommune: 3.0,
    });
    expect(tfb).toBeNull();
  });
});

describe('estimateTfbForBien — guards nbPiecesMoy <= 0', () => {
  it('retourne tfb=null si nbPiecesMoyCommune <= 0', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 1000,
      nbPiecesMoyCommune: 0,
    });
    expect(tfb).toBeNull();
  });
});

describe('estimateTfbForBien — guards tfbMoy <= 0', () => {
  it('retourne tfb=null si tfbMoyenParLogementCommune <= 0', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 0,
      nbPiecesMoyCommune: 3.0,
    });
    expect(tfb).toBeNull();
  });
});

describe('estimateTfbForBien — guards NaN/Infinity', () => {
  it('retourne tfb=null si surfaceUserM2 = NaN', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: NaN,
      tfbMoyenParLogementCommune: 1000,
      nbPiecesMoyCommune: 3.0,
    });
    expect(tfb).toBeNull();
  });

  it('retourne tfb=null si nbPiecesMoyCommune = Infinity', () => {
    const { tfb } = estimateTfbForBien({
      surfaceUserM2: 50,
      tfbMoyenParLogementCommune: 1000,
      nbPiecesMoyCommune: Infinity,
    });
    expect(tfb).toBeNull();
  });
});
