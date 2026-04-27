# Pitfalls — Pièges actifs CityRank

> Erreurs déjà rencontrées en production. Ne pas les refaire.

## Score & algorithme

### BPE absent
- **Floor à `10`** (pas 0) — un 0 tue la moyenne géométrique pour toute la commune

### DVF absent (Alsace-Moselle, Mayotte)
- Imputation régionale obligatoire — flag `dvf_imputed=true`, `dvf_imputed_method='regional_median'`
- Si `nbTx < seuil`, ignorer le prix local et imputer régional (pas assez de données)
- Normalisation gaussienne (pas linéaire) — coeff `DVF_GAUSSIAN_COEF` dans `src/lib/scoring`
- **`tx_per_hab` null** : si données DVF insuffisantes, renormaliser sur prix seul

### Géorisques
- Toutes les communes ne sont pas couvertes — logguer les manquantes en fin de batch
- Ajouter en fin de `compute-scores.ts` : `Couverture Géorisques : X communes avec score_risques / Y total`

## API & ingestion

### DPE ADEME
- Rate limit 429 fréquent — backoff exponentiel obligatoire

### BPE
- URL format CSV européen harmonisé depuis 2024 (séparateur `;`, encodage UTF-8 BOM)

### Arrondissements
- Paris/Lyon/Marseille : mapping code INSEE → code arrondissement dans `ingest-dvf.ts`

## Docker & CI/CD

- **Prisma client** : le dossier `src/lib` doit être copié dans le runner stage du Dockerfile
- **Port conflict** : arrêter le conteneur sur 3001 AVANT `docker compose up -d`
- **Prisma runner** : `binaryTargets` non configuré = Prisma client invalide sous Alpine

## compute-scores ⚠️ CRITIQUE

- **STOP = bloquant** : tout flag `STOP` ou "attendre validation humaine" interdit l'exécution auto
- **Typo de flag** : un flag inconnu (ex: `--witnesse` vs `--witnesses`) → ABORT + ping humain, pas batch complet
- **Flags valides** : `--test` (10 communes) | `--witnesses` (25 témoins) | `--depts=XX,YY` | `--audit-gaussian` | `--audit-anomalies`
- Voir `.claude/rules/proof-before-batch.md` pour la règle complète

## MCP BDD

- **OAuth web non disponible** : `mcp-db.cityrank.fr/sse` accessible uniquement depuis Claude Code (`.mcp.json`), pas depuis Claude.ai web. Dette technique loggée, à résoudre en Sprint C.
- **User `cityrank_ro` strictement read-only** : tout INSERT/UPDATE/DELETE doit échouer (test garde-fou dans `scripts/test-readonly-guardrails.ts`)
