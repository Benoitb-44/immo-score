# CLAUDE.md — CityRank

> Point d'entrée pour toute session Claude Code. À lire en début de session.

## Projet

CityRank est un site de SEO programmatique immobilier qui génère automatiquement une page pour chaque commune de France (~35 000) avec un score d'attractivité immobilière (0-100) basé exclusivement sur des données publiques open data.

- **URL prod** : cityrank.fr
- **VPS** : OVH 37.59.122.208, dossier `~/cityrank`, port 3001
- **Repo** : github.com/Benoitb-44/cityrank
- **Fondateur** : Benoît — solo non-technical, pilote via agents Claude Code

## Stack technique

Next.js 14 (App Router) + TypeScript + Tailwind + Prisma + PostgreSQL (schéma `immo_score`) + Docker Compose + GitHub Actions + nginx + n8n.

## Architecture en 4 lignes

1. **Pipeline** : 6 sources open data → scripts TS d'ingestion → PostgreSQL → score composite → pages ISR Next.js
2. **SEO programmatique** : `/commune/[slug]` ISR `revalidate: 86400` + sitemap dynamique 35k pages + JSON-LD
3. **Score 0-100** : géométrique pondéré (DVF 45%, BPE 20%, DPE 10%, Risques 25%) avec floor=10, normalisation percentile rank
4. **Isolation** : schéma PG séparé, Docker Compose dédié, nginx reverse proxy dédié (cityrank-nginx depuis 27/04/2026)

## Documentation détaillée

| Sujet | Fichier |
|-------|---------|
| Règles d'architecture & style | `.claude/memory/rules.md` |
| Pièges actifs à éviter | `.claude/memory/pitfalls.md` |
| Patterns validés | `.claude/memory/solutions.md` |
| Historique des décisions mémoire | `.claude/memory/changelog.md` |
| Contexte fondateur & sprint en cours | `.claude/memory/project_sprint0.md`, `.claude/memory/user_founder.md` |
| Agents disponibles | `.claude/agents/*.md` |
| Commandes slash | `.claude/commands/*.md` |
| ADR (décisions structurantes) | `docs/adr/*.md` |
| Document fondateur (vision produit) | `docs/immo-score-os.md` |
| Skills (patterns réutilisables) | `docs/data-ingestion.md`, `docs/seo-programmatic.md`, `docs/score-algorithm.md` |
| Journal technique des sessions | `docs/journal.md` |

## Conventions essentielles

- **Conventional commits** : `feat:`, `fix:`, `data:`, `seo:`, `docs:`, `test:`, `chore:` + tag `[memory]` pour mises à jour de `.claude/memory/`
- **Branches** : `main` = prod (auto-deploy), `claude/[description]-[id]` pour les features, squash merge obligatoire
- **PR** : review par `@code-reviewer` avant merge dans `main`
- **TypeScript strict**, pas de `any`
- **Idempotence** : tous les scripts d'ingestion utilisent UPSERT
- **NULL ≠ 0** : une commune sans donnée a NULL, pas 0

## Post-session protocol

À la fin de chaque session, mettre à jour dans cet ordre :
1. `docs/journal.md` — bloc daté résumant les modifications (remplace l'ancien "État du Site" Notion)
2. `docs/adr/` — créer un ADR si décision structurante
3. `.claude/memory/changelog.md` — si une règle/pitfall/solution a évolué

## Agents disponibles (référence rapide)

| Agent | Domaine |
|-------|---------|
| `@cto` | Architecture, ADRs, performance, scalabilité |
| `@frontend` | Pages Next.js, composants React, SEO technique |
| `@backend` | API routes, Prisma, PostgreSQL |
| `@data-engineer` | Pipeline d'ingestion, scoring, qualité données |
| `@code-reviewer` | Review PR avant merge |
| `@test-writer` | Tests unitaires & intégration |

> **Note Sprint B (à venir)** : refonte vers `@dev` + `@reviewer` + `@ops` + skills spécialisés (`security-audit`, `perf-audit`, `a11y-check`, `seo-validation`, `data-quality-check`).

## ADRs actifs

- ADR-IS-001 : Stack Technique (Next.js 14 + PostgreSQL + Prisma + Docker/OVH)
- ADR-IS-002 : ISR Strategy (revalidate 24h + on-demand)
- ADR-IS-003 : Isolation Homilink / CityRank
- ADR-IS-004 : Pipeline d'Ingestion Données (scripts TS + n8n)
- ADR-IS-005 : Algorithme Score Composite (pondéré 6 dimensions, v3.1 géométrique)
- ADR-006 : Accès BDD read-only via MCP (`cityrank_ro` + `mcp-db.cityrank.fr`)

## Contraintes business

- Budget infra < 50€/mois — VPS OVH partagé (Homilink en pause)
- Hébergement France obligatoire — souveraineté données
- Le SEO programmatique est le cœur du business : chaque décision technique doit améliorer le SEO ou ne pas le dégrader
- Les données sont publiques (open data) — citation des sources obligatoire sur chaque page
