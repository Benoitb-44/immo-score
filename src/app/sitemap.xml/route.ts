const BASE_URL = 'https://cityrank.fr';

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${BASE_URL}/sitemap/0</loc></sitemap>
  <sitemap><loc>${BASE_URL}/sitemap/1</loc></sitemap>
  <sitemap><loc>${BASE_URL}/sitemap/2</loc></sitemap>
  <sitemap><loc>${BASE_URL}/sitemap/investisseur</loc></sitemap>
</sitemapindex>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
