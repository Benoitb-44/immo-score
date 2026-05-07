# Journal technique — CityRank

> Remplace l'ancienne page Notion "État du Site". Mis à jour en fin de chaque session Claude Code.
>
> **Convention** : nouvelles sessions en haut, sessions précédentes archivées en dessous. Format `## Session YYYY-MM-DD — [thème]`.

---

## Session 2026-05-07 — DATA-v4-LOY-3M Step 3 : Ingestion OLL Paris / Lyon / AMP

**Agent(s)** : `@data-engineer`  
**Branche** : `feature/data-v4-loy-3m-ingestion`

### Livrables

| Fichier | Statut |
|---------|--------|
| `src/scripts/ingest-loyers-olap-paris.ts` | ✅ Créé — OLL Paris intra-muros → 75056 N1bis |
| `src/scripts/ingest-loyers-oll-lyon.ts` | ✅ Créé — OLL Lyon C1/C2/C3 → 69123 N1bis (agrégation pondérée) |
| `src/scripts/ingest-loyers-oll-amp.ts` | ✅ Créé — OLL AMP IRIS → 13055 N1bis (2 étapes pondération) |
| `package.json` | ✅ Modifié — +3 scripts `ingest:oll-paris`, `ingest:oll-lyon`, `ingest:oll-amp` |

### Architecture commune des scripts

- Lecture ZIP latin-1 via `unzip -p` (Paris/Lyon) ou fichiers CSV locaux UTF-8 BOM (AMP)
- Détection souple des headers CSV (multi-variantes case-insensitive)
- Witness probe step 2 avant upsert : échec = STOP (exit 1)
- UPSERT `ON CONFLICT (commune_id)` : N1 → N1bis pour 75056/69123/13055 ; 34 841 autres communes N1 intactes
- Colonnes ANIL spécifiques (`loyer_m2_ic_low`, `typpred`, `nb_obs`, `r2_adj`) nullées sur UPDATE

### Particularités OLL Lyon

- Filtre `epoque_construction_homogene = ''` (toutes époques — reprobe step 2bis validé)
- Agrégation pondérée nb_obs : C1(14,4×3237) + C2(14,0×4162) + C3(13,6×4822) → ≈13,95 €/m²
- Q1/Q3 agrégés avec même pondération

### Particularités OLL AMP

- Lecture locale `/tmp/probe-loyers/amp-loyers.csv` (pré-téléchargé probe) + `L1300Zonage2024.csv`
- Étape 1 : IRIS → 16 arrondissements (13201-13216) — log JSON `/tmp/loyers-amp-arrondissements.json`
- Étape 2 : arrondissements → 13055 — codes 13201-13216 non persistés (absents de `communes`)

### Witnesses attendus (à valider sur VPS)

```sql
SELECT commune_id, loyer_m2, nb_obs_src, niveau, source
FROM immo_score.loyer_communes
WHERE commune_id IN ('75056','69123','13055') AND niveau = 'N1bis';
```

Tolérances : 75056=26,6 exact | 69123∈[13,7;14,2] | 13055∈[11;13]

### Validation TypeScript

`tsc --noEmit --strict` ✅ (0 erreur)

---

## Session 2026-05-03 — DATA-v4-LOY-3M Phase 2 Step 1 : Migration Prisma LoyerCommune

**Agent(s)** : `@data-engineer`  
**Branche** : `claude/loyer-source-tracking-prisma-loy3m` → PR #8

### Livrables

| Fichier | Statut |
|---------|--------|
| `prisma/schema.prisma` | ✅ Modifié — +6 colonnes + @@index([niveau, source]) sur LoyerCommune |
| `prisma/migrations/migration_lock.toml` | ✅ Créé — init dossier migrations |
| `prisma/migrations/20260503000000_add_loyer_source_tracking/migration.sql` | ✅ Créé — ADD COLUMN nullable → backfill N1 → SET NOT NULL → CREATE INDEX |
| `.gitignore` | ✅ Modifié — retire prisma/migrations/ de l'exclusion |

### Changements schéma

Table `loyer_communes` : +`niveau` (NOT NULL), +`source` (NOT NULL), +`millesime` (NOT NULL), +`nbObs` (nullable), +`q1M2` Decimal(6,2)?, +`q3M2` Decimal(6,2)? + index composite `(niveau, source)`.

### Note architecturale

Ce PR initie le passage de `prisma db push` à `prisma migrate` pour les évolutions de schéma comportant du backfill. Le dossier `prisma/migrations/` est désormais versionné.

### VPS apply (après merge PR #8)

Migration SQL à appliquer manuellement — voir instructions dans la PR. Test attendu :  
`SELECT niveau, source, COUNT(*) FROM loyer_communes GROUP BY niveau, source;` → ~34 844 lignes N1 / carte_loyers_anil.

### Validation TypeScript

`prisma generate` ✅ · `tsc --noEmit` ✅ (0 erreur)

---

## Session 2026-05-01 — MONET-v4-CALC : lib calcul financier locatif

**Agent(s)** : `@backend`  
**Branche** : `feature/monet-v4-calc-lib` → PR #3

### Livrables

| Fichier | Statut |
|---------|--------|
| `src/lib/financial-constants.ts` | ✅ Créé — 12 constantes, sources CGI/ACPR/ANAH/FNAIM |
| `src/lib/financial-calc.ts` | ✅ Créé — 5 fonctions pures + `calculateAll` |
| `src/lib/__tests__/financial-calc.test.ts` | ✅ Créé — 51 tests Vitest |
| `src/lib/financial-calc.README.md` | ✅ Créé — doc + disclaimer méthodo |
| `vitest.config.ts` + `test:calc` | ✅ Vitest installé, script ajouté |

### Résultats `npm run test:calc`

```
Tests  51 passed (51)
Coverage financial-calc.ts : 100% stmts | 100% branches | 100% funcs | 100% lines
Durée  ~680ms
```

### Points méthodo découverts vs spec

- **`apport_pct` sur coût total** (prix + frais notaire) plutôt que sur le prix seul — convention standard FR, permet le cas `apport=100% → capital=0`
- **Intérêts déductibles (réel foncier)** : calculés en moyenne sur la durée (`total_interets / duree_annees`), non sur la 1ère annuité. Sous-estime les intérêts en début de prêt, surévalue en fin — acceptable pour une simulation indicative
- **Fixture Tulle synthétique** (loyer=700€/m², prix_m2=1000) : nécessaire pour démontrer LMNP > réel. Données réelles attendues via DATA-v4-LOY
- **Branche `default` exhaustive** TypeScript (`never`) non couvrables par V8 → ignorée via `/* v8 ignore next */`
- **Vacance locative** : 1/12 forfaitaire national. Impact fort sur yield_net des marchés tendus

---

## Session 2026-04-30 — Audit v4-A Accessibilité + vérif prod Bordeaux/Tulle

**Agent(s)** : `@data-engineer` + `@cto`  
**Branche** : `main`

### TÂCHE 1 — Audit cross-Cerema v4-A

**Statut : BLOQUÉ — MCP DB non accessible (401)**

La requête SQL d'audit (agrégation scores par AAV vs `d5_aav` Cerema) n'a pas pu être exécutée :
- `mcp-db.cityrank.fr` retourne HTTP 401 → déploiement `.htpasswd` sur le VPS encore en attente (ADR-006, dernière étape non appliquée)
- SSH VPS non disponible dans cette session (pas de clé)
- psql non installé en local

**Requête à lancer manuellement (VPS) :**
```sql
SELECT 
  c.aav_code,
  ROUND(AVG(s.score_accessibilite)::numeric, 1) AS score_aav_calc,
  ca.d5_aav AS d5_cerema,
  COUNT(*) AS n_communes
FROM immo_score.communes c
JOIN immo_score.score_communes s ON s.commune_id = c.id
LEFT JOIN immo_score.cerema_accessibilite ca ON ca.aav_code = c.aav_code
WHERE c.aav_code IS NOT NULL
GROUP BY c.aav_code, ca.d5_aav
HAVING COUNT(*) >= 5
ORDER BY ABS(ROUND(AVG(s.score_accessibilite)::numeric, 1) - ca.d5_aav) DESC NULLS LAST
LIMIT 20;
```
Cible : ≥ 80 % des AAV dans la tolérance ±25 %.

**Action requise** : déployer `.htpasswd` nginx MCP sur VPS pour débloquer l'accès agent.

---

### TÂCHE 2 — Vérification visuelle pages prod Bordeaux + Tulle

**Statut : ✅ CONFORME**

#### Bordeaux (`/communes/bordeaux`)

| Dimension | Score | Source affichée |
|-----------|-------|-----------------|
| Score global | **58/100** (Moyen) | — |
| DVF | 40/100 | data.gouv.fr · Poids 45 % |
| BPE | 90/100 | INSEE BPE · Poids 25 % |
| Risques | 60/100 | Géorisques · Poids 20 % |
| DPE | 90/100 | ADEME · Poids 10 % |
| **Accessibilité v4-A** | **21/100** | Cerema DV3F 2022-2024 · DVF + Filosofi · N1 |

#### Tulle (`/communes/tulle`)

| Dimension | Score | Source affichée |
|-----------|-------|-----------------|
| Score global | **84/100** (Attractif) | — |
| DVF | 81/100 | data.gouv.fr · Poids 45 % |
| BPE | 87/100 | INSEE BPE · Poids 25 % |
| Risques | 90/100 | Géorisques · Poids 20 % |
| DPE | 78/100 | ADEME · Poids 10 % |
| **Accessibilité v4-A** | **91/100** | Cerema DV3F 2022-2024 · DVF + Filosofi · N1 |

#### Checklist conformité

| Critère | Bordeaux | Tulle |
|---------|----------|-------|
| Score global affiché | ✅ 58/100 | ✅ 84/100 |
| Accessibilité v4-A visible | ✅ 21/100 | ✅ 91/100 (cible ~91) |
| Source Cerema 2022-2024 citée | ✅ | ✅ |
| Source Filosofi citée | ✅ | ✅ |
| Médiane nationale ~55 affichée | ✅ | ✅ |
| JSON-LD valide (`@type Place`, `PropertyValue`) | ✅ | ✅ |
| Classes CSS Precision Brutalism (`border-ink`, `bg-paper`, `font-mono`) | ✅ | ✅ |
| Canonical URL correcte | ✅ | ✅ |

**Point d'attention mineur** : la source DVF n'indique pas explicitement "3y" (3 dernières années) dans le libellé visible — cohérent avec le composant actuel, pas de régression.

---

## Session 2026-04-27 — Restauration MCP cityrank-db (INFRA-08 / ADR-006)

**Agent(s)** : `@backend`  
**Branche** : `claude/sprint-a-consolidation`

**Modifications** :
- `.gitignore` : ajout de `.mcp.json` (contient des credentials Basic Auth)
- `.mcp.json.example` : template versionné sans credentials
- `.mcp.json` : fichier local avec placeholder à remplir depuis 1Password
- `docs/adr/ADR-006-mcp-readonly-db.md` : création du fichier ADR (référencé dans CLAUDE.md mais absent du repo)
- `README.md` : ajout section "Setup MCP" avec instructions complètes
- `docs/adr/` : création du répertoire

**Contexte** : L'audit Orchestrateur du 27/04 a dû passer par SSH+psql en fallback car `.mcp.json` était absent du repo. Ce fichier avait été livré le 24/04 (INFRA-08) mais non commité/non restauré après. Endpoint : `https://mcp-db.cityrank.fr/sse`.

**Vérification attendue** : `/mcp` liste `cityrank-db` ✓ · `SELECT COUNT(*) FROM immo_score.communes` → 34875 ✓

---

## Session 2026-04-27 — Sprint A : Consolidation documentaire

**Agent(s)** : exécution directe (refactor structurel)
**Branche** : `claude/sprint-a-consolidation`

**Modifications** :
- Création `CLAUDE.md` consolidé (point d'entrée unique, remplace l'ancien)
- Création `.claude/memory/{rules,pitfalls,solutions,changelog}.md`
- Déplacement `memory/project_sprint0.md` et `memory/user_founder.md` → `.claude/memory/`
- Suppression `docs/agents/` (doublon avec `.claude/agents/`)
- Suppression `docs/commands.md` (doublon avec `.claude/commands/*.md`)
- Suppression `AI_MEMORY.md` (fusionné dans `.claude/memory/`)
- Suppression dossier `memory/` (déplacé)
- Création `docs/journal.md` (ce fichier — remplace la page Notion "État du Site")

**Bugs corrigés** : aucun
**Schéma BDD** : aucun changement
**Scripts d'ingestion** : aucun changement

**À surveiller** : vérifier que toutes les références aux anciens chemins ont été corrigées (grep clean sur `AI_MEMORY`, `memory/MEMORY`, `docs/agents`).

**Prochain Sprint** : Sprint B — Refonte rôles & agents (`@dev`, `@reviewer`, `@ops` + skills spécialisés).
