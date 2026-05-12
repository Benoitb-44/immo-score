/**
 * test-taxe-fonciere.ts
 * Script de validation witnesses — Taxe Foncière Bâtie (DATA-v4-TF)
 *
 * 10 communes témoins : Tulle, Sarlat, Bordeaux, Rennes, Lyon, Le Mans,
 *                       Paris, Hyères, Saint-Juvin, Vichy
 *
 * Critères de validation :
 *   - taux_communal_pct dans fourchette attendue (probe OFGL 2024 ±1%)
 *   - montant_tfb_communal NOT NULL et > 0
 *   - montant_tfb_total = communal + epci (cohérence)
 *
 * Usage :
 *   npm run test:taxe-fonciere
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Witness {
  nom: string;
  code_insee: string;
  taux_communal_expected?: number; // % attendu (probe OFGL 2024)
  taux_tolerance?: number;         // tolérance ± (défaut 1.0%)
}

// Taux OFGL 2024 depuis probe report (2026-05-11) et probe direct
const WITNESSES: Witness[] = [
  { nom: 'Tulle',            code_insee: '19272', taux_communal_expected: 49.59, taux_tolerance: 1.0 },
  { nom: 'Sarlat-la-Canéda', code_insee: '24520' },                        // pas de taux probe disponible
  { nom: 'Bordeaux',         code_insee: '33063', taux_communal_expected: 48.48, taux_tolerance: 0.5 },
  { nom: 'Rennes',           code_insee: '35238', taux_communal_expected: 45.66, taux_tolerance: 1.0 },
  { nom: 'Lyon',             code_insee: '69123', taux_communal_expected: 31.89, taux_tolerance: 0.5 },
  { nom: 'Le Mans',          code_insee: '72181', taux_communal_expected: 34.71, taux_tolerance: 1.0 },
  { nom: 'Paris',            code_insee: '75056', taux_communal_expected: 20.50, taux_tolerance: 0.5 },
  { nom: 'Hyères',           code_insee: '83069' },
  { nom: 'Saint-Juvin',      code_insee: '08383', taux_communal_expected: 34.72, taux_tolerance: 1.0 },
  { nom: 'Vichy',            code_insee: '03310' },
];

interface TestResult {
  nom: string;
  code_insee: string;
  status: 'OK' | 'FAIL' | 'MISSING';
  taux_communal_pct: number | null;
  taux_epci_pct: number | null;
  montant_tfb_communal: number | null;
  montant_tfb_epci: number | null;
  montant_tfb_total: number | null;
  secret_statistique: boolean;
  reason?: string;
}

async function runWitnesses(): Promise<void> {
  const t0 = Date.now();
  console.log('=== test-taxe-fonciere — Witnesses DATA-v4-TF ===\n');

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;

  for (const w of WITNESSES) {
    const row = await prisma.taxeFonciereCommune.findUnique({
      where: { code_commune: w.code_insee },
    });

    if (!row) {
      missing++;
      results.push({
        nom: w.nom,
        code_insee: w.code_insee,
        status: 'MISSING',
        taux_communal_pct: null,
        taux_epci_pct: null,
        montant_tfb_communal: null,
        montant_tfb_epci: null,
        montant_tfb_total: null,
        secret_statistique: false,
        reason: 'Aucune ligne en base — ingest non exécuté ou commune absente',
      });
      continue;
    }

    const errors: string[] = [];

    // Check 1 : données présentes (sauf secret)
    if (!row.secret_statistique && row.montant_tfb_communal === null) {
      errors.push('montant_tfb_communal est NULL sans secret_statistique');
    }

    // Check 2 : taux dans fourchette si disponible
    if (w.taux_communal_expected !== undefined && row.taux_communal_pct !== null) {
      const tolerance = w.taux_tolerance ?? 1.0;
      const diff = Math.abs(row.taux_communal_pct - w.taux_communal_expected);
      if (diff > tolerance) {
        errors.push(
          `taux_communal_pct=${row.taux_communal_pct}% hors fourchette` +
          ` attendu=${w.taux_communal_expected}% ±${tolerance}%`,
        );
      }
    } else if (w.taux_communal_expected !== undefined && row.taux_communal_pct === null) {
      errors.push('taux_communal_pct NULL alors que valeur probe disponible');
    }

    // Check 3 : cohérence montant_tfb_total
    if (
      row.montant_tfb_communal !== null &&
      row.montant_tfb_total !== null
    ) {
      const epci = row.montant_tfb_epci ?? 0;
      const expectedTotal = row.montant_tfb_communal + epci;
      const diff = Math.abs((row.montant_tfb_total ?? 0) - expectedTotal);
      if (diff > 1) { // tolérance 1€ pour arrondi float
        errors.push(
          `montant_tfb_total incohérent : ${row.montant_tfb_total} ≠ ${expectedTotal}`,
        );
      }
    }

    const status = errors.length === 0 ? 'OK' : 'FAIL';
    if (status === 'OK') passed++; else failed++;

    results.push({
      nom: w.nom,
      code_insee: w.code_insee,
      status,
      taux_communal_pct: row.taux_communal_pct,
      taux_epci_pct: row.taux_epci_pct,
      montant_tfb_communal: row.montant_tfb_communal,
      montant_tfb_epci: row.montant_tfb_epci,
      montant_tfb_total: row.montant_tfb_total,
      secret_statistique: row.secret_statistique,
      reason: errors.join(' | ') || undefined,
    });
  }

  // Tableau de résultats
  console.log(
    'Code   Commune               Status  Taux_com%  Taux_epci%  MontantTotal(€)   Secret',
  );
  console.log('─'.repeat(90));

  for (const r of results) {
    const status = r.status === 'OK' ? '✅ OK  ' : r.status === 'FAIL' ? '❌ FAIL' : '⚠ MISS ';
    const tauxC = r.taux_communal_pct !== null ? r.taux_communal_pct.toFixed(2).padStart(8) : '     N/A';
    const tauxE = r.taux_epci_pct !== null ? r.taux_epci_pct.toFixed(2).padStart(9) : '      N/A';
    const total = r.montant_tfb_total !== null
      ? r.montant_tfb_total.toLocaleString('fr-FR').padStart(16)
      : '             N/A';
    const sec = r.secret_statistique ? '  🔒' : '';
    console.log(
      `${r.code_insee}  ${r.nom.padEnd(20)} ${status}  ${tauxC}  ${tauxE}  ${total}${sec}`,
    );
    if (r.reason) console.log(`         ↳ ${r.reason}`);
  }

  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('─'.repeat(90));
  console.log(`\nRésultat : ${passed}/10 OK | ${failed} FAIL | ${missing} MISSING — ${duration}s`);

  if (failed > 0 || missing > 0) {
    console.error('\n❌ Witnesses non conformes — NE PAS merger avant correction');
    process.exit(1);
  } else {
    console.log('\n✅ Tous les witnesses OK — prêt pour merge prod');
  }
}

runWitnesses()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
