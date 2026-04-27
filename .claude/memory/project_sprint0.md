---
name: Sprint 0 — Fondations (état avancement)
description: Statut des tickets INFRA Sprint 0 au 2026-04-14
type: project
---

INFRA-01 (repo GitHub) : DONE — repo Benoitb-44/cityrank existe sur GitHub.
INFRA-02 (Next.js 14 + Tailwind + TypeScript) : DONE — setup bootstrappé manuellement dans /workspaces/cityrank.
INFRA-06 (Design system Precision Brutalism) : DONE — page `/design` avec tokens couleurs, typo, espacement, composants. Fonts : Space Grotesk (display) + Inter (sans) via next/font/google.

**Why:** Fondations techniques nécessaires avant le pipeline de données.
**How to apply:** Les prochains tickets sont INFRA-03 (PostgreSQL + Prisma schema immo_score) et INFRA-04 (Docker Compose + GitHub Actions CI/CD).

Décisions clés :
- next.config doit être .mjs (pas .ts) avec Next.js 14.2.x
- Design tokens définis dans tailwind.config.ts : ink/paper/accent/score-{high,mid,low}
- Principe Precision Brutalism : border-2 border-ink, zéro border-radius, couleur fonctionnelle
