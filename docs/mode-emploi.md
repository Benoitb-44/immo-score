# Mode d'emploi — Immo Score × Claude Code

> Pour Benoît — Fondateur solo, non-technique, qui pilote le projet entièrement via les agents Claude Code.
> 
> **À lire une fois. À relire quand tu es bloqué.**

---

## Sommaire

1. [Comment fonctionne Claude Code](#1-comment-fonctionne-claude-code)
2. [Les agents — qui fait quoi](#2-les-agents--qui-fait-quoi)
3. [Les commandes — actions rapides](#3-les-commandes--actions-rapides)
4. [Workflows concrets](#4-workflows-concrets)
5. [Comment formuler une bonne demande](#5-comment-formuler-une-bonne-demande)
6. [Erreurs courantes à éviter](#6-erreurs-courantes-à-éviter)
7. [Référence rapide](#7-référence-rapide)

---

## 1. Comment fonctionne Claude Code

### Le principe de base

Claude Code est un assistant qui peut **lire, écrire et modifier le code** de ton projet directement. Ce n'est pas un chatbot — c'est un développeur qui travaille dans ton repo.

Chaque conversation est une **session de travail**. À la fin d'une session, les fichiers sont modifiés sur le disque. Rien n'est perdu entre les sessions (le code reste).

### Ce que Claude Code peut faire

- Lire tous les fichiers du projet
- Créer et modifier des fichiers
- Lancer des commandes terminal (`npm run build`, `npx tsx script.ts`, etc.)
- Faire des recherches sur le web
- Interagir avec GitHub (créer des PRs, lire des issues)
- Interagir avec Notion si le MCP est connecté

### Ce qu'il ne fait PAS tout seul

- Déployer en production sans confirmation
- Supprimer des branches ou écraser du travail en cours sans te prévenir
- Prendre des décisions stratégiques à ta place (il exécute, toi tu décides)

---

## 2. Les agents — qui fait quoi

### Principe

Les agents sont des **personas spécialisés**. Quand tu invoques `@cto`, Claude adopte la posture, les priorités et les conventions du CTO d'Immo Score. Il connaît l'archi, le budget, les contraintes.

**Syntaxe :** commence ton message par `@nom-agent`

```
@frontend crée le composant ScoreGauge
```

> Si tu n'invoques pas d'agent, Claude répond en mode généraliste — moins précis pour les tâches techniques.

---

### @cto — Architecte en chef

**Quand l'appeler :**
- Tu as un problème de performance (site lent, TTFB élevé)
- Tu dois choisir entre deux approches techniques
- Tu veux documenter une décision (ADR)
- Tu doutes que l'architecture tienne à 35 000 pages

**Exemples concrets :**
```
@cto notre sitemap met 30 secondes à charger en production, qu'est-ce qu'on fait ?

@cto je veux ajouter une page /region/[code] — quelle est la meilleure approche 
avec ISR pour ne pas casser les perfs ?

@cto rédige l'ADR pour notre choix de garder Prisma plutôt que de passer à Drizzle
```

**Ce qu'il produit :** analyses, ADRs, recommandations documentées avec justification et alternatives écartées.

---

### @frontend — Développeur React/Next.js

**Quand l'appeler :**
- Créer ou modifier une page (`/commune/[slug]`, `/departement/[code]`, etc.)
- Créer un composant React (ScoreGauge, SearchBar, CommuneCard…)
- Problème de meta tags, structured data, sitemap
- L'interface ne s'affiche pas correctement
- Optimiser les Core Web Vitals

**Exemples concrets :**
```
@frontend la page commune n'affiche pas la section risques — corrige-la

@frontend crée le composant ScoreGauge : une jauge circulaire 0-100 avec 
la couleur qui change selon la plage (vert/orange/rouge)

@frontend le title SEO ne contient pas le département — corrige generateMetadata 
dans /commune/[slug]/page.tsx

@frontend crée la page /departement/[code] avec la liste des communes triées 
par score décroissant
```

**Ce qu'il produit :** fichiers `.tsx`, modifications de pages Next.js, composants Tailwind.

---

### @backend — Développeur API/BDD

**Quand l'appeler :**
- Créer ou modifier une API route (`/api/search`, `/api/scores`, `/api/revalidate`)
- Modifier le schéma Prisma (ajouter un champ, une table)
- Problème de requête SQL (lenteur, erreur)
- Gérer la revalidation ISR

**Exemples concrets :**
```
@backend crée la route /api/search?q= avec la recherche trigram PostgreSQL 
pour l'autocomplete

@backend ajoute un champ arrondissement à la table communes dans le schéma Prisma

@backend la requête qui récupère les communes voisines est trop lente, optimise-la 
avec un index sur les coordonnées GPS

@backend crée la route /api/revalidate protégée par secret pour déclencher 
l'ISR on-demand
```

**Ce qu'il produit :** fichiers `route.ts`, modifications `schema.prisma`, migrations.

---

### @data-engineer — Ingénieur données

**Quand l'appeler :**
- Écrire ou corriger un script d'ingestion
- Un script plante sur certaines communes
- Modifier le calcul du score composite
- Vérifier la qualité des données après ingestion
- Ajouter une nouvelle source de données

**Exemples concrets :**
```
@data-engineer le script ingest-dvf.ts plante sur les communes DOM-TOM 
(code INSEE commence par 97), corrige-le

@data-engineer les données BPE n'ont pas de médecins pour les communes 
de moins de 500 hab — ajuste le calcul d'équipements pour ne pas pénaliser 
les petites communes

@data-engineer je veux ajouter la note TripAdvisor touristique comme 7ème 
dimension du score — qu'est-ce que ça impliquerait ?

@data-engineer génère un rapport de qualité des données : combien de communes 
ont des NULL par dimension ?
```

**Ce qu'il produit :** scripts TypeScript dans `src/scripts/`, modifications de `compute-scores.ts`.

---

### @code-reviewer — Revieweur de PR

**Quand l'appeler :**
- Avant de merger une branche dans `main`
- Pour valider le travail d'un autre agent
- Pour t'assurer qu'il n'y a pas de bug ou faille de sécurité

**Exemples concrets :**
```
@code-reviewer review la PR #12 avant que je la merge

@code-reviewer voici le diff du script ingest-bpe.ts — est-ce que tout est correct ?
```

**Ce qu'il produit :** rapport structuré ✅/⚠️/❌ avec liste des changements requis.

> **Règle :** invoquer `@code-reviewer` avant chaque merge dans `main`. C'est ton filet de sécurité.

---

### @test-writer — Développeur de tests

**Quand l'appeler :**
- Après avoir créé une nouvelle feature
- Quand un bug a été corrigé (pour éviter la régression)
- Pour tester l'algorithme de score

**Exemples concrets :**
```
@test-writer écris les tests unitaires pour la fonction percentileRank 
dans compute-scores.ts

@test-writer crée les fixtures de test pour ingest-dvf.ts avec 5 communes 
dont une DOM-TOM et une sans données
```

**Ce qu'il produit :** fichiers de test Vitest dans `src/__tests__/`.

---

### @pm — Product Manager

**Quand l'appeler :**
- Pour décider quoi faire ensuite
- Pour transformer une idée en ticket actionnable
- Pour prioriser entre deux features
- Pour faire le point sur la roadmap et les OKRs

**Exemples concrets :**
```
@pm je veux ajouter un comparateur de communes — est-ce que c'est prioritaire 
par rapport à la page département ?

@pm on est en semaine 3, fais le point sur le Sprint 1 : qu'est-ce qui est fait, 
qu'est-ce qui reste ?

@pm j'ai une idée : afficher la tendance de prix sur 3 ans avec un graphique. 
Formule-moi ça en ticket avec les critères d'acceptation.
```

**Ce qu'il produit :** tickets formatés, analyses de priorisation RICE, synthèses de roadmap.

---

## 3. Les commandes — actions rapides

Les commandes sont des **recettes pré-définies** pour les opérations récurrentes.

**Syntaxe :** `/nom-commande [argument optionnel]`

---

### /ingest-data [source]

Lance un script d'ingestion de données.

```
/ingest-data dvf          → ingère les prix DVF
/ingest-data dpe          → ingère les DPE ADEME
/ingest-data bpe          → ingère les équipements BPE
/ingest-data risques      → ingère les risques Géorisques
/ingest-data fiscalite    → ingère les taxes foncières
/ingest-data demo         → ingère la démographie INSEE
/ingest-data communes     → recharge la table de référence COG
/ingest-data all          → tout ingérer + compute-scores à la fin
```

**Quand l'utiliser :** chaque mois, quand les données open data sont mises à jour. Ou quand un script a été corrigé.

---

### /compute-scores

Recalcule les scores de toutes les communes.

```
/compute-scores
```

**Quand l'utiliser :** après chaque ingestion (automatique si tu utilises `/ingest-data all`), ou quand tu modifies les pondérations du score.

---

### /status

Vérifie la fraîcheur des données et l'état du pipeline.

```
/status
```

**Ce que ça affiche :**
```
Source          | Dernière MAJ    | Communes renseignées | Statut
DVF             | 2026-03-15      | 34 821 / 35 000      | ✅ Frais
DPE ADEME       | 2026-02-01      | 28 450 / 35 000      | ✅ Frais
BPE INSEE       | 2025-11-20      | 35 000 / 35 000      | ⚠️ À rafraîchir
...
```

**Quand l'utiliser :** en début de session pour savoir où en sont les données, avant un déploiement.

---

### /audit-seo [slug]

Audite le SEO d'une page commune.

```
/audit-seo bordeaux
/audit-seo paris-1er
/audit-seo saint-martin-de-re
```

**Ce que ça vérifie :** title, meta description, JSON-LD, canonical, internal linking.

**Quand l'utiliser :** après avoir modifié le template de page commune, ou pour débugger une page qui ne se positionne pas.

---

### /deploy

Déclenche le déploiement en production.

```
/deploy
```

**Quand l'utiliser :** quand une PR a été mergée dans `main` et que tu veux t'assurer que le déploiement GitHub Actions s'est bien lancé.

---

### /sprint-update

Met à jour le Journal Notion avec le résumé de la session.

```
/sprint-update
```

**Quand l'utiliser :** en fin de chaque session de travail, pour garder une trace des décisions.

> Nécessite que le MCP Notion soit connecté.

---

## 4. Workflows concrets

### Workflow A — Corriger un bug

```
1. Décris le bug précisément à l'agent concerné
   "@frontend la section DPE de la page commune s'affiche vide même quand 
   les données existent en base"

2. L'agent trouve le problème, te propose un fix, l'applique

3. @code-reviewer review le fix

4. Si OK → merge dans main → /deploy
```

---

### Workflow B — Ajouter une nouvelle feature

```
1. Demande à @pm de formuler le ticket
   "@pm je veux une page /top-communes qui liste les 100 meilleures communes 
   par score — formule le ticket"

2. @pm te donne les critères d'acceptation et l'agent concerné

3. Tu demandes à l'agent concerné de l'implémenter
   "@frontend implémente la page /top-communes selon ce ticket : [colle le ticket]"

4. @test-writer écrit les tests si nécessaire

5. @code-reviewer review

6. Merge + /deploy
```

---

### Workflow C — Refresh mensuel des données

```
1. /status → vérifie ce qui est à jour ou non

2. /ingest-data all → lance toutes les ingestions + recalcul des scores
   (peut prendre 30-60 minutes)

3. /compute-scores si tu veux voir les stats de distribution

4. Vérifie que le site affiche bien les nouvelles données :
   /audit-seo [une commune test]

5. /sprint-update → log la session dans Notion
```

---

### Workflow D — Décision d'architecture

```
1. @cto j'hésite entre [option A] et [option B] pour [problème]
   → donne-lui le contexte complet, les contraintes (budget, SEO, perf)

2. @cto te produit une analyse avec recommandation + ADR si décision importante

3. Tu valides ou tu demandes d'approfondir

4. @backend ou @frontend implémente la décision
```

---

### Workflow E — Début de session (check-in)

```
1. /status → état des données
2. @pm où en est-on sur le Sprint en cours ?
3. Choisir la tâche prioritaire et invoquer le bon agent
```

---

## 5. Comment formuler une bonne demande

### La règle d'or : contexte + action + contrainte

❌ **Mauvais :**
```
améliore la page commune
```

✅ **Bon :**
```
@frontend la section "Équipements" de la page /commune/[slug] affiche 
les icônes mais pas les chiffres (nb écoles, nb médecins). 
Les données sont bien en base (table immo_score.equipements). 
Corrige l'affichage sans toucher aux autres sections.
```

---

### Règles pratiques

**1 agent par session**
Ne mélange pas `@frontend` et `@backend` dans le même message. Si tu as besoin des deux, fais deux sessions séparées.

**Donne les erreurs complètes**
Si quelque chose plante, copie-colle le message d'erreur complet. Ne paraphrase pas.

```
@data-engineer ce script plante avec cette erreur :
TypeError: Cannot read properties of undefined (reading 'prix_m2_median')
    at computeScore (compute-scores.ts:47:23)
```

**Indique ce qui ne doit PAS changer**
```
@frontend modifie uniquement la section DPE, ne touche pas au reste de la page
```

**Demande une validation avant d'agir sur la prod**
```
@backend avant d'appliquer la migration Prisma, montre-moi ce que ça va changer
```

---

### Quand une demande est trop vague

Si tu n'es pas sûr de ce que tu veux, commence par `@pm` :

```
@pm j'ai l'impression que les pages des petites communes (< 500 hab) 
ne donnent pas assez confiance aux utilisateurs à cause du manque de données. 
Qu'est-ce qu'on pourrait faire ?
```

`@pm` va t'aider à formuler le problème et proposer des options priorisées.

---

## 6. Erreurs courantes à éviter

### ❌ Demander à un agent de faire le travail d'un autre

```
// Mauvais — @frontend ne gère pas les scripts d'ingestion
@frontend corrige le script qui ingère les données DVF
```

```
// Bon
@data-engineer corrige le script ingest-dvf.ts
```

---

### ❌ Merger sans review

Ne jamais faire `git merge main` ou approuver une PR sans avoir passé `@code-reviewer` dessus. Même pour un "petit changement".

---

### ❌ Vouloir tout faire en une seule session

```
// Trop ambitieux pour une session
@frontend crée toutes les pages du site : commune, département, région, 
comparateur, blog, page d'accueil
```

```
// Bonne approche : une feature par session
@frontend crée uniquement la page /commune/[slug] avec les 7 sections 
définies dans docs/agents/frontend.md
```

---

### ❌ Ne pas préciser ce qui est attendu

```
// Trop vague
@backend améliore les performances
```

```
// Précis et actionnable
@backend la requête qui charge les données d'une commune prend 800ms. 
Profile la requête et ajoute les index manquants.
```

---

### ❌ Ignorer les erreurs de CI/CD

Si GitHub Actions échoue après un merge, ne pas ignorer. Vérifier avec :
```
@backend le build GitHub Actions échoue avec cette erreur : [colle l'erreur]
```

---

## 7. Référence rapide

### Agents

| Agent | Domaine | Signal d'invocation |
|-------|---------|---------------------|
| `@cto` | Architecture, performance, ADRs | "choisir entre", "tient à l'échelle ?", "ADR" |
| `@frontend` | Pages Next.js, composants, SEO | "page", "composant", "s'affiche", "meta tags" |
| `@backend` | API routes, Prisma, SQL | "API", "route", "schéma", "requête", "BDD" |
| `@data-engineer` | Scripts d'ingestion, scores | "script", "ingestion", "score", "données" |
| `@code-reviewer` | Validation avant merge | "review", "valide", "merge" |
| `@test-writer` | Tests unitaires/intégration | "tests", "Vitest", "fixture" |
| `@pm` | Roadmap, priorisation, tickets | "priorité", "roadmap", "ticket", "quoi faire" |

### Commandes

| Commande | Action | Fréquence |
|----------|--------|-----------|
| `/status` | Vérifie fraîcheur des données | Début de session |
| `/ingest-data [source]` | Lance un script d'ingestion | Mensuel |
| `/ingest-data all` | Refresh complet + scores | Mensuel |
| `/compute-scores` | Recalcule les 35 000 scores | Après ingestion |
| `/audit-seo [slug]` | Audite le SEO d'une page | Après modif template |
| `/deploy` | Déclenche déploiement prod | Après merge main |
| `/sprint-update` | Log la session dans Notion | Fin de session |

### Workflow standard

```
Début de session
    ↓
/status + @pm où en est-on ?
    ↓
Choisir la tâche → invoquer le bon agent
    ↓
Agent travaille (lire, coder, tester)
    ↓
@code-reviewer review
    ↓
Merge dans main → /deploy
    ↓
/sprint-update
```

---

*Dernière mise à jour : avril 2026*
