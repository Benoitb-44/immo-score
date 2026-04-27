# Rules — Architecture & Style

> Règles non-négociables pour CityRank. À respecter dans chaque session Claude Code.

## Données & schéma

- **Schéma PG isolé** : `immo_score` (la `DATABASE_URL` doit contenir `?schema=immo_score`)
- **Idempotence** : tous les scripts d'ingestion utilisent UPSERT, jamais INSERT seul
- **NULL ≠ 0** : une commune sans données DVF a `prix_m2_median = NULL`, pas `0`
- **Traçabilité** : chaque table a un champ `updated_at` mis à jour à chaque ingestion
- **Données brutes immutables** : jamais supprimées, seulement écrasées par des données plus récentes

## Code & build

- **Prisma binaryTargets** : toujours `["native", "linux-musl-openssl-3.0.x"]` (Docker Alpine)
- **Build order** : `prisma generate && next build` — ne jamais inverser
- **`'use client'`** : interdit sauf SearchBar et Comparateur
- **ISR** : `revalidate: 86400` sur toutes les pages commune
- **`force-dynamic`** : obligatoire sur `/sitemap.xml` et `/departements` (prerender sans DB = crash)
- **Tailwind uniquement** — pas de CSS modules
- **TypeScript strict** : pas de `any`, types explicites sur les fonctions publiques

## Déploiement

- **VPS path** : `~/cityrank` (anciennement `~/immo-score`, migré)
- **Port** : 3001 — `docker stop $(docker ps -q --filter "publish=3001")` avant redeploy
- **Reverse proxy** : nginx-cityrank dédié depuis 27/04/2026 (plus partagé avec Homilink)
- **Domaines actifs** : cityrank.fr + mcp-db.cityrank.fr
- **Certs Let's Encrypt** : rotation tous les 90 jours pour tous credentials/htpasswd
- **JAMAIS `docker compose down` sur la prod** — toujours `docker compose restart cityrank`

## Git

- **Branches** : `main` = prod (auto-deploy), `claude/[description]-[id]` pour features
- **Merge** : squash merge uniquement, après review `@code-reviewer`
- **Conventional commits** : `feat:`, `fix:`, `data:`, `seo:`, `docs:`, `test:`, `chore:`
- **Tag `[memory]`** sur les commits qui modifient `.claude/memory/`

## Post-session

- Mettre à jour `docs/journal.md` à la fin de chaque session (bloc daté)
- Créer un ADR dans `docs/adr/` pour toute décision structurante
- Mettre à jour `.claude/memory/changelog.md` si règle/pitfall/solution évolue

## Sécurité

- API routes protégées par secret quand mutation (ex. `/api/revalidate`)
- Rate limiting sur les routes publiques (`/api/scores`, `/api/search`)
- Headers de sécurité nginx (HSTS, X-Frame-Options, X-Content-Type-Options)
- Credentials jamais committés — `.env.vps` en gitignore
- Accès BDD agents : uniquement via user `cityrank_ro` (read-only) — voir ADR-006
