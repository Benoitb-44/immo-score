import { describe, it, expect, vi } from 'vitest';
import {
  getTaxeFonciereForCommune,
  estimateTfbForBien,
  type TaxeFonciereData,
} from '../repositories/taxe-fonciere.repository';
import type { PrismaClient } from '@prisma/client';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePrisma(
  tfbRow: object | null,
  deptAvg: number | null = null,
  nationalAvg: number | null = null,
): PrismaClient {
  const $queryRaw = vi
    .fn()
    .mockResolvedValueOnce(
      deptAvg != null ? [{ avg_tfb: String(deptAvg) }] : [{ avg_tfb: null }],
    )
    .mockResolvedValueOnce(
      nationalAvg != null ? [{ avg_tfb: String(nationalAvg) }] : [{ avg_tfb: null }],
    );

  return {
    taxeFonciereCommune: {
      findUnique: vi.fn().mockResolvedValue(tfbRow),
    },
    $queryRaw,
  } as unknown as PrismaClient;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROW_BORDEAUX = {
  montant_tfb_total: 242_000_000,
  taux_communal_pct: 43.46,
  taux_epci_pct: 5.02,
  source: 'ofgl-rei',
  secret_statistique: false,
};

const ROW_SECRET = {
  montant_tfb_total: null,
  taux_communal_pct: null,
  taux_epci_pct: null,
  source: 'ofgl-rei',
  secret_statistique: true,
};

// ─── Tests — getTaxeFonciereForCommune ────────────────────────────────────────

describe('getTaxeFonciereForCommune — cas normal (Bordeaux 33063)', () => {
  it('retourne les données directes sans fallback', async () => {
    const prisma = makePrisma(ROW_BORDEAUX);
    const result = await getTaxeFonciereForCommune('33063', prisma);

    expect(result).not.toBeNull();
    expect(result!.montant_tfb_total).toBe(242_000_000);
    expect(result!.taux_communal_pct).toBeCloseTo(43.46, 2);
    expect(result!.secret_statistique).toBe(false);
    expect(result!.fallback_used).toBe('none');
  });
});

describe('getTaxeFonciereForCommune — secret_statistique → fallback département', () => {
  it('utilise la médiane départementale quand la commune est secrète', async () => {
    const prisma = makePrisma(ROW_SECRET, 50_000_000);
    const result = await getTaxeFonciereForCommune('75056', prisma);

    expect(result).not.toBeNull();
    expect(result!.montant_tfb_total).toBe(50_000_000);
    expect(result!.fallback_used).toBe('departement_median');
    expect(result!.secret_statistique).toBe(true);
  });
});

describe('getTaxeFonciereForCommune — commune absente → fallback dept vide → fallback national', () => {
  it('cascade jusqu-à la médiane nationale quand dept et commune sans données', async () => {
    const prisma = makePrisma(null, null, 30_000_000);
    const result = await getTaxeFonciereForCommune('08383', prisma);

    expect(result).not.toBeNull();
    expect(result!.montant_tfb_total).toBe(30_000_000);
    expect(result!.fallback_used).toBe('national_median');
  });
});

// ─── Tests — estimateTfbForBien ───────────────────────────────────────────────

describe('estimateTfbForBien — estimation 50m² (fourchette Data Scientist 1500–2500 €)', () => {
  it('Paris 50m² : résultat dans [1500, 2500 €] avec données filosofi synthétiques', () => {
    // Données calibrées : 160M € totaux / 80 000 logements = 2 000 €/logement moyen 50m²
    const tfbData: TaxeFonciereData = {
      montant_tfb_total: 160_000_000,
      taux_communal_pct: 20.5,
      taux_epci_pct: null,
      source: 'ofgl-rei',
      secret_statistique: false,
      fallback_used: 'none',
    };

    const result = estimateTfbForBien(
      tfbData,
      { nb_logements: 80_000, surface_moy: 50 },
      50,
    );

    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(1500);
    expect(result!).toBeLessThanOrEqual(2500);
  });

  it('retourne null si filosofiData est null', () => {
    const tfbData: TaxeFonciereData = {
      montant_tfb_total: 100_000_000,
      taux_communal_pct: null,
      taux_epci_pct: null,
      source: 'ofgl-rei',
      secret_statistique: false,
      fallback_used: 'none',
    };
    expect(estimateTfbForBien(tfbData, null, 70)).toBeNull();
  });

  it('retourne null si montant_tfb_total est null', () => {
    const tfbData: TaxeFonciereData = {
      montant_tfb_total: null,
      taux_communal_pct: null,
      taux_epci_pct: null,
      source: 'ofgl-rei',
      secret_statistique: false,
      fallback_used: 'none',
    };
    expect(estimateTfbForBien(tfbData, { nb_logements: 1000, surface_moy: 60 }, 70)).toBeNull();
  });

  it('proportionne correctement par rapport à la surface simulée', () => {
    const tfbData: TaxeFonciereData = {
      montant_tfb_total: 100_000,
      taux_communal_pct: null,
      taux_epci_pct: null,
      source: 'ofgl-rei',
      secret_statistique: false,
      fallback_used: 'none',
    };
    // 100 000 / 100 logements = 1 000 €/logement avec surface_moy 50m²
    // Pour 100m² : 1 000 × (100/50) = 2 000 €
    const r100 = estimateTfbForBien(tfbData, { nb_logements: 100, surface_moy: 50 }, 100);
    // Pour 25m² : 1 000 × (25/50) = 500 €
    const r25 = estimateTfbForBien(tfbData, { nb_logements: 100, surface_moy: 50 }, 25);

    expect(r100).toBeCloseTo(2000, 1);
    expect(r25).toBeCloseTo(500, 1);
  });
});
