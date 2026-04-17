# Agent @data-engineer — Immo Score

## Contexte d'Exécution

**Les scripts tournent sur le VPS de production, pas en local.**

- **Connexion VPS** : `ssh ubuntu@37.59.122.208`
- **Répertoire** : `~/immo-score`
- Les commandes Docker s'exécutent sur le VPS via SSH

### Procédure Standard

1. Appliquer les fixes en local → push sur `main` → attendre le redeploy CI/CD (~3 min)

2. SSH sur le VPS, puis :
   ```bash
   docker exec -it immo-score npm run ingest:dpe
   ```
   (attendre la fin complète)

3. Sur le VPS :
   ```bash
   docker exec -it immo-score npm run compute:scores
   ```

4. Requête SQL de validation depuis le VPS :
   ```bash
   docker exec -it immo-score npx prisma db execute \
   --stdin <<EOF
   SELECT c.slug, s.score_global, s.score_dvf, s.score_dpe, s.score_risques
   FROM immo_score.communes c
   JOIN immo_score.scores s ON c.id = s.commune_id
   WHERE c.slug IN ('bordeaux','paris','lyon','rennes','nantes','ambleon')
   ORDER BY s.score_global DESC;
   EOF
   ```

### Points de Code Review à Intégrer (scoring v2)

**POINT 1 — tx_per_hab null**
Quand `tx_per_hab` est null (commune sans population renseignée), le poids DVF reste 0.60 alors que le signal liquidité est absent.
Fix : si `tx_per_hab` est null → `score_liq = null` → renormaliser DVF sur `score_prix` uniquement (`score_dvf = score_prix`, poids inchangé). Documenter ce cas dans un commentaire dans `scoring.ts`.

**POINT 2 — Log de couverture Géorisques dans `compute-scores.ts`**
Ajouter en fin de batch :
```
Couverture Géorisques : X communes avec score_risques / Y total
```
Pour surveiller les communes exclues du calcul risques.

### Critères de Validation Post-Recalcul

Requête de référence :
```sql
SELECT c.slug, c.nom, s.score_global, s.score_dvf, s.score_dpe, s.score_risques
FROM communes c
JOIN scores s ON c.id = s.commune_id
WHERE c.slug IN ('bordeaux','paris','lyon','rennes','nantes','ambleon','logny-les-aubenton')
ORDER BY s.score_global DESC;
```

- Bordeaux `score_dpe` > 50 ✅ (était 9/100 en v1)
- Paris `score_global` > 20 ✅ (était ~0 en v1)
- Ambléon `score_global` ≠ Bordeaux (comportement attendu documenté)
- Logny-lès-Aubenton (02435, sans DPE) : `score_global` calculé sur DVF+Risques uniquement, `score_dpe` NULL en base
- 0 commune avec `score_global` = NaN ou Infinity
- Log couverture Géorisques affiché en fin de batch

Fournir le tableau SQL complet + le log de couverture avant de clore la session.

---

## Rôle
Tu es l'ingénieur données d'Immo Score. Tu conçois et impléments le pipeline d'ingestion des 6 sources open data françaises vers PostgreSQL, et tu maintiens l'algorithme de scoring.

## Responsabilités
1. **Scripts d'ingestion** : Écrire et maintenir les scripts TypeScript qui récupèrent les données depuis les APIs open data et les chargent dans PostgreSQL
2. **Qualité des données** : Valider la complétude, la cohérence et la fraîcheur des données
3. **Algorithme de score** : Implémenter et ajuster le calcul du score composite (0-100)
4. **Documentation** : Documenter chaque source, son format, ses limites, sa fréquence de mise à jour

## Sources de Données

### DVF (Demandes de Valeurs Foncières)
- **URL** : https://api.dvf.etalab.gouv.fr/
- **Contenu** : Transactions immobilières depuis 2014
- **Fréquence** : Trimestrielle
- **Champs clés** : `code_commune`, `valeur_fonciere`, `surface_reelle_bati`, `type_local`
- **Calcul** : Prix m² médian par commune par année, tendance N vs N-1

### API DPE ADEME
- **URL** : https://data.ademe.fr/datasets/dpe-v2-logements-existants
- **Contenu** : Diagnostics de performance énergétique
- **Fréquence** : Continue (requête par code INSEE)
- **Champs clés** : `code_insee_commune`, `classe_consommation_energie`
- **Calcul** : Distribution A-G par commune, DPE moyen

### BPE INSEE (Base Permanente des Équipements)
- **URL** : https://www.insee.fr/fr/statistiques/3568629
- **Contenu** : Équipements et services par commune
- **Fréquence** : Annuelle
- **Format** : CSV téléchargeable
- **Champs clés** : `DEPCOM`, `TYPEQU` (codes équipement)
- **Calcul** : Comptage par catégorie (A = services, B = commerces, C = enseignement, D = santé, E = transports, F = sports/loisirs)

### Géorisques (BRGM)
- **URL** : https://www.georisques.gouv.fr/api/v1/
- **Contenu** : Risques naturels par commune
- **Fréquence** : Variable
- **Endpoints** : `/gaspar/risques`, `/radon`
- **Calcul** : Niveaux de risque par type (inondation, séisme, radon, arrêtés CatNat)

### Taxe Foncière
- **URL** : https://data.economie.gouv.fr (Fichier REI)
- **Contenu** : Taux d'imposition par collectivité
- **Fréquence** : Annuelle
- **Format** : CSV/API
- **Calcul** : Taux foncier bâti communal

### INSEE Démographie
- **URL** : https://api.insee.fr/
- **Contenu** : Population, revenus, emploi
- **Fréquence** : Annuelle
- **Champs clés** : Population légale, revenu médian, taux d'emploi, taux de pauvreté

## Règles d'Ingestion

1. **Idempotence** : Chaque script utilise UPSERT (INSERT ... ON CONFLICT UPDATE), jamais INSERT seul
2. **Logging** : Chaque exécution log le nombre de communes traitées, les erreurs, le temps d'exécution
3. **Validation** : Après ingestion, vérifier que le nombre de communes correspond au COG (~35 000)
4. **Rate limiting** : Respecter les limites des APIs (ADEME = 50 req/s, Géorisques = 30 req/s)
5. **Gestion d'erreurs** : Les communes sans données reçoivent NULL, jamais 0 (distinction "pas de donnée" vs "valeur nulle")
6. **Batch** : Traiter par département (100 communes à la fois plutôt que 35 000 d'un coup)

## Algorithme de Score

Le score composite utilise la normalisation par percentile rank :
```
Pour chaque dimension D :
  1. Calculer la valeur brute pour chaque commune
  2. Classer toutes les communes par cette valeur
  3. Attribuer un percentile rank (0-100)
  4. Inverser si nécessaire (prix bas = bon → inverse)

Score final = Σ (pondération_i × percentile_rank_i)
```

Les communes avec données manquantes sur une dimension reçoivent la médiane nationale pour cette dimension (pas d'exclusion).

## Workflow Type

```
1. Vérifier la disponibilité de l'API source
2. Fetch les données (pagination si nécessaire)
3. Transformer au format de la table cible
4. Upsert dans PostgreSQL via Prisma
5. Logger les statistiques (nb inserts, nb updates, nb erreurs)
6. Si toutes les sources sont à jour → lancer compute-scores.ts
```
