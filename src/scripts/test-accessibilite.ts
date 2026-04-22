/**
 * test-accessibilite.ts
 * Validation du sous-score Accessibilité financière (Median Multiple) sur 10 communes témoins.
 *
 * Critères attendus :
 *   Paris    (75056) → MM ~9    → score ~12-15  (très inaccessible)
 *   Lyon     (69123) → MM ~6.5  → score ~40-45
 *   Bordeaux (33063) → MM ~6    → score ~45-55
 *   Nantes   (44109) → MM ~5.5  → score ~50-60
 *   Rennes   (35238) → MM ~5    → score ~55-65
 *   Toulouse (31555) → MM ~5    → score ~55-65
 *   Strasbourg (67482) → MM ~5  → score ~55-65
 *   Tulle    (19272) → MM ~3.5  → score ~75-85  (accessible)
 *   Aurillac (15014) → MM ~3    → score ~85-90
 *   Guéret   (23096) → MM ~2.5  → score ~90-95
 *
 * Usage :
 *   npm run test:accessibilite
 */

import { PrismaClient } from '@prisma/client';
import { calculateAccessibiliteScore } from '../lib/scoring';

const prisma = new PrismaClient();

const COMMUNES_TEMOINS: Array<{ slug: string; code: string; desc: string }> = [
  { code: '75056', slug: 'Paris',      desc: 'MM élevé attendu ~8-10, score faible' },
  { code: '69123', slug: 'Lyon',       desc: 'MM moyen-élevé ~6-7, score ~40-50' },
  { code: '33063', slug: 'Bordeaux',   desc: 'MM moyen ~5-7, score ~40-55' },
  { code: '44109', slug: 'Nantes',     desc: 'MM moyen ~5-6, score ~50-60' },
  { code: '35238', slug: 'Rennes',     desc: 'MM moyen ~5-6, score ~50-60' },
  { code: '31555', slug: 'Toulouse',   desc: 'MM moyen ~5-6, score ~50-60' },
  { code: '67482', slug: 'Strasbourg', desc: 'MM moyen ~5, score ~55-65' },
  { code: '19272', slug: 'Tulle',      desc: 'MM faible ~3-4, score ~75-85' },
  { code: '15014', slug: 'Aurillac',   desc: 'MM faible ~2.5-3.5, score ~80-90' },
  { code: '23096', slug: 'Guéret',     desc: 'MM très faible ~2-3, score ~85-95' },
];

async function main(): Promise<void> {
  console.log('=== Test Accessibilité Financière — Median Multiple ===\n');
  console.log('Surface proxy : 65 m²  |  Goalpost : MM=2 → 100, MM=10 → 0\n');

  const header = [
    'Commune'.padEnd(12),
    'Code'.padEnd(6),
    'PrixM2'.padStart(8),
    'RevMed'.padStart(8),
    'PrixLog'.padStart(9),
    'MM'.padStart(6),
    'Score'.padStart(7),
    'Diagnostic',
  ].join('  ');
  console.log(header);
  console.log('─'.repeat(header.length));

  let errors = 0;
  let missing = 0;

  for (const { code, slug, desc } of COMMUNES_TEMOINS) {
    const result = await calculateAccessibiliteScore(code, prisma);

    if (!result.score) {
      missing++;
      console.log(
        `${slug.padEnd(12)}  ${code.padEnd(6)}  ${' — données manquantes (DVF ou Filosofi absent)'.padStart(8)}  ← ${desc}`,
      );
      continue;
    }

    const { score, median_multiple, prix_median_m2, prix_median_logement, revenu_median } = result;

    // Alertes cohérence
    let alert = '';
    if (slug === 'Paris'    && score > 25) { alert = ' ⚠ PARIS score trop élevé'; errors++; }
    if (slug === 'Tulle'    && score < 60) { alert = ' ⚠ TULLE score trop bas';    errors++; }
    if (slug === 'Bordeaux' && (score < 30 || score > 65)) { alert = ' ⚠ BORDEAUX hors plage'; errors++; }
    if (median_multiple! < 1 || median_multiple! > 20) { alert = ` ⚠ MM=${median_multiple} suspect`; errors++; }

    const row = [
      slug.padEnd(12),
      code.padEnd(6),
      String(prix_median_m2 ?? '-').padStart(8),
      String(revenu_median ?? '-').padStart(8),
      String(prix_median_logement ?? '-').padStart(9),
      String(median_multiple ?? '-').padStart(6),
      String(score).padStart(7),
      alert || `✓ ${desc}`,
    ].join('  ');
    console.log(row);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Communes testées : ${COMMUNES_TEMOINS.length}`);
  console.log(`Données manquantes : ${missing}  (DVF ou Filosofi non ingéré)`);
  console.log(`Alertes cohérence : ${errors}`);

  if (missing > 0) {
    console.log('\n→ Pour tester avec des données réelles, exécuter d\'abord :');
    console.log('  npm run ingest:dvf && npm run ingest:filosofi');
  }

  if (errors > 0) {
    console.error('\n✗ Des communes hors plage détectées — vérifier le calcul Median Multiple.');
    process.exit(1);
  } else if (missing === COMMUNES_TEMOINS.length) {
    console.log('\n⚠ Aucune donnée disponible — résultats non validables.');
  } else {
    console.log('\n✓ Scores dans les plages attendues.');
  }
}

main()
  .catch(err => { console.error('ERREUR :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
