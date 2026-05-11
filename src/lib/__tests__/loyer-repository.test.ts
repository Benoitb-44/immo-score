import { describe, it, expect, vi } from 'vitest';
import { getLoyerForCommune, type LoyerCommuneData } from '../repositories/loyer.repository';
import type { PrismaClient } from '@prisma/client';

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Construit un stub PrismaClient minimaliste dont loyerCommune.findFirst
 * retourne `row`. Les champs Decimal (q1M2, q3M2) sont simulés par des nombres
 * bruts : Number(n) === n, ce qui couvre la branche de conversion du repository.
 */
function makePrisma(row: object | null): PrismaClient {
  return {
    loyerCommune: {
      findFirst: vi.fn().mockResolvedValue(row),
    },
  } as unknown as PrismaClient;
}

// ─── Fixtures (données prod — ingestion PR #8) ────────────────────────────────

const ROW_PARIS = {
  loyer_m2: 26.6,
  q1M2: 23.20,
  q3M2: 30.30,
  nbObs: 3686,
  source: 'oll_paris',
  niveau: 'N1bis',
  millesime: 2024,
};

const ROW_LYON = {
  loyer_m2: 13.95,
  q1M2: 12.21,
  q3M2: 16.07,
  nbObs: 12221,
  source: 'oll_lyon',
  niveau: 'N1bis',
  millesime: 2024,
};

const ROW_AMP = {
  loyer_m2: 13.0,
  q1M2: 10.90,
  q3M2: 15.60,
  nbObs: 29778,
  source: 'oll_amp',
  niveau: 'N1bis',
  millesime: 2024,
};

const ROW_BORDEAUX = {
  loyer_m2: 12.5,
  q1M2: null,
  q3M2: null,
  nbObs: null,
  source: 'carte_loyers_anil',
  niveau: 'N1',
  millesime: 2023,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getLoyerForCommune — witnesses prod (MONET-v4-CALC DATA-v4-LOY)', () => {
  it('75056 Paris → oll_paris N1bis, loyer=26.6, q1=23.20, q3=30.30, nb_obs=3686', async () => {
    const result = await getLoyerForCommune('75056', makePrisma(ROW_PARIS));

    expect(result).not.toBeNull();
    const data = result as LoyerCommuneData;
    expect(data.source).toBe('oll_paris');
    expect(data.niveau).toBe('N1bis');
    expect(data.loyer_m2).toBeCloseTo(26.6, 2);
    expect(data.q1_m2).toBeCloseTo(23.20, 2);
    expect(data.q3_m2).toBeCloseTo(30.30, 2);
    expect(data.nb_obs).toBe(3686);
    expect(data.millesime).toBe(2024);
  });

  it('69123 Lyon → oll_lyon N1bis, loyer=13.95, q1=12.21, q3=16.07, nb_obs=12221', async () => {
    const result = await getLoyerForCommune('69123', makePrisma(ROW_LYON));

    expect(result).not.toBeNull();
    const data = result as LoyerCommuneData;
    expect(data.source).toBe('oll_lyon');
    expect(data.niveau).toBe('N1bis');
    expect(data.loyer_m2).toBeCloseTo(13.95, 2);
    expect(data.q1_m2).toBeCloseTo(12.21, 2);
    expect(data.q3_m2).toBeCloseTo(16.07, 2);
    expect(data.nb_obs).toBe(12221);
    expect(data.millesime).toBe(2024);
  });

  it('13055 Marseille → oll_amp N1bis, loyer=13.0, q1=10.90, q3=15.60, nb_obs=29778', async () => {
    const result = await getLoyerForCommune('13055', makePrisma(ROW_AMP));

    expect(result).not.toBeNull();
    const data = result as LoyerCommuneData;
    expect(data.source).toBe('oll_amp');
    expect(data.niveau).toBe('N1bis');
    expect(data.loyer_m2).toBeCloseTo(13.0, 2);
    expect(data.q1_m2).toBeCloseTo(10.90, 2);
    expect(data.q3_m2).toBeCloseTo(15.60, 2);
    expect(data.nb_obs).toBe(29778);
    expect(data.millesime).toBe(2024);
  });

  it('33063 Bordeaux → carte_loyers_anil N1, q1/q3/nb_obs = null', async () => {
    const result = await getLoyerForCommune('33063', makePrisma(ROW_BORDEAUX));

    expect(result).not.toBeNull();
    const data = result as LoyerCommuneData;
    expect(data.source).toBe('carte_loyers_anil');
    expect(data.niveau).toBe('N1');
    expect(data.loyer_m2).toBeGreaterThan(0);
    expect(data.q1_m2).toBeNull();
    expect(data.q3_m2).toBeNull();
    expect(data.nb_obs).toBeNull();
    expect(data.millesime).toBe(2023);
  });

  it('commune absente → retourne null (pas de throw)', async () => {
    // Comportement documenté : null = commune sans donnée loyer.
    // Consommateur (financial-calc) doit gérer ce cas via garde explicite.
    const result = await getLoyerForCommune('99999', makePrisma(null));
    expect(result).toBeNull();
  });
});

describe('getLoyerForCommune — branche loyer_m2 null', () => {
  it('ligne présente mais loyer_m2=null → retourne null', async () => {
    const rowWithoutLoyer = { ...ROW_BORDEAUX, loyer_m2: null };
    const result = await getLoyerForCommune('33063', makePrisma(rowWithoutLoyer));
    expect(result).toBeNull();
  });
});

describe('getLoyerForCommune — appel Prisma', () => {
  it('appelle findFirst avec commune_id correct et orderBy niveau asc', async () => {
    const stub = makePrisma(ROW_PARIS);
    await getLoyerForCommune('75056', stub);

    const findFirst = (stub.loyerCommune as unknown as { findFirst: ReturnType<typeof vi.fn> }).findFirst;
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { commune_id: '75056' },
        orderBy: { niveau: 'asc' },
      }),
    );
  });
});
