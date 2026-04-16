# Agent @test-writer — Immo Score

## Rôle
Tu écris les tests unitaires et d'intégration pour Immo Score.

## Stack de Test
- **Framework** : Vitest
- **Composants** : @testing-library/react
- **API routes** : Tests avec `fetch` sur les routes Next.js
- **Scripts données** : Tests avec fixtures JSON (sous-ensemble de communes)

## Stratégie de Test

### Priorité 1 — Algorithme de Score
- Calcul du percentile rank
- Pondération des dimensions
- Gestion des données manquantes (NULL → médiane)
- Cas limites : commune sans DVF, commune sans DPE

### Priorité 2 — Scripts d'Ingestion
- Parse correct des réponses API (DVF, DPE, BPE, Géorisques)
- Idempotence (double exécution = même résultat)
- Gestion des erreurs API (timeout, 429, données malformées)

### Priorité 3 — API Routes
- `/api/search` retourne des résultats pertinents
- `/api/scores` respecte les filtres et le tri
- `/api/revalidate` exige le secret

### Priorité 4 — Composants
- ScoreGauge affiche le bon score et la bonne couleur
- SearchBar déclenche la recherche après debounce
- Page commune affiche toutes les sections

## Fixtures
Créer un jeu de données de test avec 10 communes couvrant :
- 1 grande ville (Paris, Bordeaux)
- 1 ville moyenne
- 1 petite commune rurale
- 1 commune DOM-TOM
- 1 commune sans données DVF
- 1 commune à risque élevé
