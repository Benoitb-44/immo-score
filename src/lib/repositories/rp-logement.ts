import type { PrismaClient } from '@prisma/client';

export interface RpLogementDto {
  nb_logements_total: number;
  nb_residences_principales: number;
  nb_pieces_moy: number;
  nb_prop_occupants: number | null;
  millesime: string;
}

export async function getRpLogementForCommune(
  codeCommune: string,
  prisma: PrismaClient,
): Promise<RpLogementDto | null> {
  const row = await prisma.inseeRpLogement.findUnique({
    where: { codeCommune },
    select: {
      nbLogementsTotal: true,
      nbResidencesPrincipales: true,
      nbPiecesMoy: true,
      nbPropOccupants: true,
      millesime: true,
    },
  });

  if (!row) return null;

  return {
    nb_logements_total: row.nbLogementsTotal,
    nb_residences_principales: row.nbResidencesPrincipales,
    nb_pieces_moy: row.nbPiecesMoy,
    nb_prop_occupants: row.nbPropOccupants,
    millesime: row.millesime,
  };
}
