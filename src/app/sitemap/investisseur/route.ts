export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'https://cityrank.fr';

/**
 * Sitemap Wave 1 — 500 URLs /communes/[slug]/investisseur
 *
 * Sélection : communes avec loyer_communes + DVF disponibles,
 * triées par volume de transactions DVF décroissant.
 */
export async function GET() {
  let urlEntries = '';

  try {
    const rows = await prisma.$queryRaw<{ slug: string; updated_at: string | null }[]>`
      SELECT c.slug, lc.updated_at::text AS updated_at
      FROM immo_score.communes c
      JOIN immo_score.loyer_communes lc ON lc.commune_id = c.code_insee
      WHERE lc.loyer_m2 IS NOT NULL
      ORDER BY (
        SELECT COUNT(*) FROM immo_score.dvf_prix d
        WHERE d.code_commune = c.code_insee AND d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
      ) DESC
      LIMIT 500
    `;

    const now = new Date().toISOString();
    urlEntries = rows
      .map(
        (r) =>
          `<url><loc>${BASE_URL}/communes/${r.slug}/investisseur</loc><lastmod>${r.updated_at ?? now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      )
      .join('\n  ');
  } catch {
    urlEntries = '';
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400',
    },
  });
}
