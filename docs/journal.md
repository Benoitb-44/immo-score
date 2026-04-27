# Journal technique — CityRank

> Remplace l'ancienne page Notion "État du Site". Mis à jour en fin de chaque session Claude Code.
>
> **Convention** : nouvelles sessions en haut, sessions précédentes archivées en dessous. Format `## Session YYYY-MM-DD — [thème]`.

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
