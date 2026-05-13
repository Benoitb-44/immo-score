import { describe, it, expect, vi } from 'vitest';
import { getRpLogementForCommune } from '../repositories/rp-logement';
import type { PrismaClient } from '@prisma/client';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePrisma(row: object | null): PrismaClient {
  return {
    inseeRpLogement: {
      findUnique: vi.fn().mockResolvedValue(row),
    },
  } as unknown as PrismaClient;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROW_PARIS = {
  nbLogementsTotal: 1399122.26,
  nbResidencesPrincipales: 1089642.0,
  nbPiecesMoy: 2.58,
  nbPropOccupants: 217928.0,
  millesime: 'RP2022',
};

const ROW_LYON = {
  nbLogementsTotal: 265400.0,
  nbResidencesPrincipales: 232100.0,
  nbPiecesMoy: 2.72,
  nbPropOccupants: 62000.0,
  millesime: 'RP2022',
};

const ROW_BORDEAUX = {
  nbLogementsTotal: 140200.0,
  nbResidencesPrincipales: 121900.0,
  nbPiecesMoy: 2.81,
  nbPropOccupants: 38400.0,
  millesime: 'RP2022',
};

const ROW_TULLE = {
  nbLogementsTotal: 10200.0,
  nbResidencesPrincipales: 7900.0,
  nbPiecesMoy: 3.15,
  nbPropOccupants: 3600.0,
  millesime: 'RP2022',
};

const ROW_SAINT_PIERREMONT = {
  nbLogementsTotal: 87.0,
  nbResidencesPrincipales: 48.0,
  nbPiecesMoy: 3.42,
  nbPropOccupants: null,
  millesime: 'RP2022',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getRpLogementForCommune — Paris (75056)', () => {
  it('retourne le DTO correctement mappé', async () => {
    const prisma = makePrisma(ROW_PARIS);
    const result = await getRpLogementForCommune('75056', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_logements_total).toBeCloseTo(1399122.26, 1);
    expect(result!.nb_pieces_moy).toBeCloseTo(2.58, 2);
    expect(result!.millesime).toBe('RP2022');
    expect(result!.nb_prop_occupants).toBeCloseTo(217928.0, 0);
  });
});

describe('getRpLogementForCommune — Lyon (69123)', () => {
  it('retourne les données RP Lyon correctement', async () => {
    const prisma = makePrisma(ROW_LYON);
    const result = await getRpLogementForCommune('69123', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_logements_total).toBeCloseTo(265400.0, 0);
    expect(result!.nb_pieces_moy).toBeCloseTo(2.72, 2);
  });
});

describe('getRpLogementForCommune — Bordeaux (33063)', () => {
  it('retourne les données RP Bordeaux correctement', async () => {
    const prisma = makePrisma(ROW_BORDEAUX);
    const result = await getRpLogementForCommune('33063', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_pieces_moy).toBeCloseTo(2.81, 2);
    expect(result!.nb_residences_principales).toBeCloseTo(121900.0, 0);
  });
});

describe('getRpLogementForCommune — Tulle (19272)', () => {
  it('retourne les données RP Tulle correctement', async () => {
    const prisma = makePrisma(ROW_TULLE);
    const result = await getRpLogementForCommune('19272', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_pieces_moy).toBeCloseTo(3.15, 2);
  });
});

describe('getRpLogementForCommune — Saint-Pierremont (08394)', () => {
  it('retourne null pour nb_prop_occupants quand absent', async () => {
    const prisma = makePrisma(ROW_SAINT_PIERREMONT);
    const result = await getRpLogementForCommune('08394', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_prop_occupants).toBeNull();
    expect(result!.nb_logements_total).toBeCloseTo(87.0, 0);
  });
});

describe('getRpLogementForCommune — commune absente', () => {
  it('retourne null sans fallback si commune introuvable', async () => {
    const prisma = makePrisma(null);
    const result = await getRpLogementForCommune('99999', prisma);

    expect(result).toBeNull();
  });
});

describe('getRpLogementForCommune — sécurité division par zéro', () => {
  it('retourne nb_pieces_moy >= 0 même pour très petite commune', async () => {
    const prisma = makePrisma({
      nbLogementsTotal: 5.0,
      nbResidencesPrincipales: 3.0,
      nbPiecesMoy: 4.0,
      nbPropOccupants: null,
      millesime: 'RP2022',
    });
    const result = await getRpLogementForCommune('01001', prisma);

    expect(result).not.toBeNull();
    expect(result!.nb_pieces_moy).toBeGreaterThan(0);
    expect(Number.isFinite(result!.nb_pieces_moy)).toBe(true);
  });
});
