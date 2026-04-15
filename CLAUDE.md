# CLAUDE.md — Immo Score

## Projet

Immo Score est un site de SEO programmatique immobilier qui génère automatiquement une page pour chaque commune de France (~35 000) avec un score d'attractivité immobilière (0-100) basé exclusivement sur des données publiques open data.

**URL** : immorank.fr (production) — repo cloné dans ~/immo-score sur le VPS OVH
**Repo** : github.com/Benoitb-44/immo-score
**Fondateur** : Benoît — solo non-technical founder, ne code pas, délègue tout aux agents Claude Code.

## Stack Technique

- **Frontend/SSR** : Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **ORM** : Prisma
- **BDD** : PostgreSQL (schéma `immo_score` sur le VPS OVH partagé avec Homilink)
- **Conteneur** : Docker Compose (fichier séparé de Homilink)
- **CI/CD** : GitHub Actions → deploy sur OVH VPS
- **Reverse proxy** : nginx (server block dédié)
- **Orchestration données** : n8n (n8n.homilink.fr)
- **Analytics** : Umami (self-hosted, RGPD)

## Architecture Clé

### Pipeline de Données
6 sources open data → scripts d'ingestion TypeScript → PostgreSQL → score composite → pages ISR Next.js

Sources : DVF (prix m²), API DPE ADEME (performance énergétique), BPE INSEE (équipements), Géorisques (risques naturels), data.economie.gouv (taxe foncière), INSEE (démographie).

### SEO Programmatique
- Route `/commune/[slug]` avec ISR `revalidate: 86400` (24h)
- Sitemap dynamique `/sitemap.xml` pour ~35 000 pages
- Structured data JSON-LD sur chaque page
- Internal linking : communes voisines + même département

### Score Composite (0-100)
Score pondéré normalisé sur 6 dimensions :
- Prix attractifs (25%) — normalisation inverse prix m²
- Performance DPE (15%) — % logements A-C
- Fiscalité légère (15%) — normalisation inverse taxe foncière
- Équipements (20%) — score composite / 1000 hab
- Risques faibles (10%) — normalisation inverse risques
- Dynamisme démo (15%) — croissance pop + revenus + emploi

Normalisation par percentile rank, puis somme pondérée.

### Isolation avec Homilink
- Schéma PostgreSQL séparé : `immo_score`
- Docker Compose séparé : `docker-compose.immo.yml`
- Repo GitHub séparé
- Server block nginx séparé
- Aucune dépendance de code entre les deux projets

## Conventions

### Git
- Branch `main` = production
- Branches feature : `claude/[description]-[id]`
- PR obligatoire avec review par @code-reviewer
- Conventional commits : `feat:`, `fix:`, `data:`, `seo:`, `docs:`

### Code
- TypeScript strict mode
- Prisma pour toutes les requêtes BDD (sauf agrégations complexes → raw SQL)
- Composants React : fonction + export default
- Pas de `'use client'` sauf nécessité absolue (SearchBar, Comparateur)
- Tailwind uniquement pour le styling, pas de CSS modules
- Tests : Vitest + Testing Library

### Données
- Chaque script d'ingestion est idempotent (upsert, pas insert)
- Chaque table a un champ `updated_at`
- Le score est recalculé après chaque ingestion via `compute-scores.ts`
- Les données brutes ne sont jamais supprimées, seulement écrasées

### SEO
- Chaque page commune a un `<title>` unique : "Immobilier [Commune] : Score, Prix, DPE, Risques | Immo Score"
- Meta description dynamique avec score et prix m²
- Schema.org JSON-LD : `Place` + `PropertyValue` pour le score
- Canonical URL obligatoire
- Pas de contenu dupliqué entre pages (le template varie selon les données)

## Commandes Utiles

```bash
# Dev local
npm run dev                    # Next.js dev server
npm run db:push                # Prisma push schema
npm run db:seed                # Seed communes de référence

# Ingestion données
npm run ingest:communes        # Table de référence COG
npm run ingest:dvf             # Prix m² DVF
npm run ingest:dpe             # DPE ADEME
npm run ingest:bpe             # Équipements BPE
npm run ingest:risques         # Géorisques
npm run ingest:fiscalite       # Taxe foncière
npm run ingest:demo            # Démographie INSEE
npm run compute:scores         # Calcul score composite

# Production
make deploy                    # Deploy via GitHub Actions
make logs                      # Logs Docker
make ssh                       # SSH vers VPS
```

## Agents Disponibles

- **@cto** : Architecture, ADRs, choix techniques, performance
- **@frontend** : Composants React, pages Next.js, Tailwind, SEO technique
- **@backend** : API routes, Prisma, scripts d'ingestion, PostgreSQL
- **@data-engineer** : Pipeline de données, scripts d'ingestion, qualité données, algorithme score
- **@code-reviewer** : Review PR, qualité code, conventions
- **@test-writer** : Tests unitaires, tests d'intégration, fixtures données

## ADRs

- ADR-IS-001 : Stack Technique (Next.js 14 + PostgreSQL + Prisma + Docker/OVH)
- ADR-IS-002 : ISR Strategy (revalidate 24h + on-demand)
- ADR-IS-003 : Isolation Homilink / Immo Score
- ADR-IS-004 : Pipeline d'Ingestion Données (scripts TS + n8n)
- ADR-IS-005 : Algorithme Score Composite (pondéré 6 dimensions)

## Context Important

- Le fondateur ne code pas — il pilote via les agents. Toute décision technique doit être justifiée et documentée.
- Budget infra < 50€/mois — le VPS est partagé avec Homilink.
- Hébergement France obligatoire (OVH) — souveraineté données.
- Le SEO programmatique est le cœur du projet : chaque décision technique doit être évaluée à travers le prisme "est-ce que ça aide le SEO ?".
- Les données sont publiques (open data) — pas de problème de licence, mais citation des sources obligatoire sur chaque page.
