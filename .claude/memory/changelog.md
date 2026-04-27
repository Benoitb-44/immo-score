# Changelog — Mémoire CityRank

> Historique des évolutions des règles, pièges et solutions. Ordre antéchronologique.

## 2026-04-27 — Sprint A : Consolidation documentaire

- Fusion `AI_MEMORY.md` + `memory/MEMORY.md` + sections de `CLAUDE.md` en structure unifiée `.claude/memory/`
- Suppression duplication `docs/agents/` → `.claude/agents/` (source unique = `.claude/agents/`)
- Suppression `docs/commands.md` (doublon avec `.claude/commands/`)
- Création `docs/journal.md` (remplace page Notion "État du Site")
- Nouveau `CLAUDE.md` comme point d'entrée unique avec table de référence vers tous les fichiers de doc
- ADR-006 (MCP BDD read-only) confirmé en place

## 2026-04-27 — Homilink en pause

- Décommissionnement du VPS Homilink, archives PG conservées (`~/archives/homilink-pg-2026-04-24.sql.gz`)
- Modes Homilink restent dans Notion mais inactifs
- Ne pas pousser de nouvelles actions Homilink sans confirmation explicite

## 2026-04-27 — Infra CityRank dédiée

- nginx reverse proxy dédié (cityrank-nginx, plus partagé avec Homilink)
- nginx système désactivé+masqué
- Stack `~/cityrank/docker-compose.yml`
- Domaines actifs : cityrank.fr (cert exp 2026-07-19) + mcp-db.cityrank.fr (cert exp 2026-07-26)

## 2026-04-27 — MCP BDD read-only opérationnel

- INFRA-08 : endpoint `https://mcp-db.cityrank.fr/sse`, Basic Auth `claude_agent`
- Accessible via Claude Code (`.mcp.json`), PAS Claude.ai web (dette OAuth loggée)
- User PG `cityrank_ro` read-only sur schéma `immo_score`
- Voir ADR-006 pour détails

## 2026-04-22 — Initialisation AI_MEMORY

- Première version basée sur analyse des commits + architecture projet
