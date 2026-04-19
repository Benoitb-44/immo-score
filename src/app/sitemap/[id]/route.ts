export const dynamic = 'force-dynamic';
export const revalidate = 86400;

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

const prisma = new PrismaClient();
const BATCH_SIZE = 20000;
const BASE_URL = 'https://immorank.fr';

const DEPARTEMENTS = [
  '01','02','03','04','05','06','07','08','09','10',
  '11','12','13','14','15','16','17','18','19','21',
  '22','23','24','25','26','27','28','29','2A','2B',
  '30','31','32','33','34','35','36','37','38','39',
  '40','41','42','43','44','45','46','47','48','49',
  '50','51','52','53','54','55','56','57','58','59',
  '60','61','62','63','64','65','66','67','68','69',
  '70','71','72','73','74','75','76','77','78','79',
  '80','81','82','83','84','85','86','87','88','89',
  '90','91','92','93','94','95','971','972','973',
  '974','976',
];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  let urlEntries: string;

  if (id === 2) {
    const now = new Date().toISOString();
    const staticUrls = [
      `<url><loc>${BASE_URL}/</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      `<url><loc>${BASE_URL}/methodologie</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
      `<url><loc>${BASE_URL}/departements</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
      ...DEPARTEMENTS.map(
        (d) =>
          `<url><loc>${BASE_URL}/departements/${d}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`
      ),
    ];
    urlEntries = staticUrls.join('\n  ');
  } else {
    const communes = await prisma.commune.findMany({
      orderBy: { code_insee: 'asc' },
      skip: id * BATCH_SIZE,
      take: BATCH_SIZE,
      select: {
        slug: true,
        score: { select: { score_global: true, updated_at: true } },
      },
    });

    urlEntries = communes
      .map((c) => {
        const s = c.score?.score_global ?? 30;
        const priority = s >= 70 ? 0.9 : s >= 30 ? 0.7 : 0.5;
        const lastmod = (c.score?.updated_at ?? new Date()).toISOString();
        return `<url><loc>${BASE_URL}/communes/${c.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${priority}</priority></url>`;
      })
      .join('\n  ');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `s-maxage=${revalidate}, stale-while-revalidate=${revalidate}`,
    },
  });
}
