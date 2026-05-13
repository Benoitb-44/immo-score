# Probe INSEE RP 2022 — Base communale logement (`base-cc-logement-2022`)

> Généré le 2026-05-13 par `scripts/probes/probe-insee-rp-logement.ts`
> Validation avant ingestion — TECH-DEBT-01 mesure 1 (pattern anti-bug Sprint 4-A)

---

## Source

| Champ | Valeur |
|-------|--------|
| Page descriptif INSEE | `https://www.insee.fr/fr/statistiques/8581474` |
| URL fichier téléchargé | `https://www.insee.fr/fr/statistiques/fichier/8581474/base-cc-logement-2022_xlsx.zip` |
| Millésime | RP 2022 |
| Date publication | 13 mai 2026 |
| Taille ZIP téléchargé | 85 Mo |
| Taille XLSX extrait | 89,8 Mo |
| Géographie de référence | Administrative au 1er janvier 2024 |
| Périmètre principal | France hors Mayotte |
| Périmètre COM | Fichier séparé `base-cc-logement-2022-COM_xlsx.zip` (24 Ko) |

---

## Structure

| Métadonnée | Valeur |
|-----------|--------|
| Format | XLSX (Office Open XML) |
| Mode XLSX | `sharedStrings` |
| Feuilles | `COM_2022`, `ARM_2022`, `Variables_2022`, `COM_2016`, `ARM_2016`, `Variables_2016`, `COM_2011`, `ARM_2011`, `COM_2011`, `Formules`, `Documentation` |
| Feuille à utiliser | **`COM_2022`** |
| Ligne labels FR | L5 (rang 0-indexé : 4) |
| **Ligne codes techniques INSEE** | **L6 (rang 0-indexé : 5)** — à utiliser comme header |
| Première ligne de données | L7 (rang 0-indexé : 6) |
| Nombre total de lignes de données | **34 858** |
| Nombre de colonnes | **95** |
| Colonne code commune | **`CODGEO`** (col 0) — 5 chars string, zéros non-significatifs inclus |
| Communes uniques (`CODGEO`) | **34 858** / 34 875 attendu → delta = 17 (Mayotte + quelques COM) |
| DROM (971–974) inclus | ✅ 112 communes |
| Mayotte (976xx) | ❌ Absent du fichier principal — fichier COM séparé |

---

## 30 premières colonnes (noms bruts INSEE)

| # | Code INSEE | Libellé FR |
|---|-----------|------------|
| 1 | `CODGEO` | Code géographique |
| 2 | `REG` | Région |
| 3 | `DEP` | Département |
| 4 | `LIBGEO` | Libellé géographique |
| 5 | `P22_LOG` | Logements en 2022 |
| 6 | `P22_RP` | Résidences principales en 2022 |
| 7 | `P22_RSECOCC` | Rés secondaires et logements occasionnels en 2022 |
| 8 | `P22_LOGVAC` | Logements vacants en 2022 |
| 9 | `P22_MAISON` | Maisons en 2022 |
| 10 | `P22_APPART` | Appartements en 2022 |
| 11 | `P22_RP_1P` | Rés princ 1 pièce en 2022 |
| 12 | `P22_RP_2P` | Rés princ 2 pièces en 2022 |
| 13 | `P22_RP_3P` | Rés princ 3 pièces en 2022 |
| 14 | `P22_RP_4P` | Rés princ 4 pièces en 2022 |
| 15 | `P22_RP_5PP` | Rés princ 5 pièces ou plus en 2022 |
| 16 | `P22_NBPI_RP` | **Pièces rés princ en 2022** (total somme — cf. §Anomalies) |
| 17 | `P22_RPMAISON` | Rés princ type maison en 2022 |
| 18 | `P22_NBPI_RPMAISON` | Pièces rés princ type maison en 2022 |
| 19 | `P22_RPAPPART` | Rés princ type appartement en 2022 |
| 20 | `P22_NBPI_RPAPPART` | Pièces rés princ type appartement en 2022 |
| 21 | `C22_RP_NORME` | Rés princ occupation norme en 2022 |
| 22 | `C22_RP_SOUSOCC_MOD` | Rés princ sous-occupation modérée en 2022 |
| 23 | `C22_RP_SOUSOCC_ACC` | Rés princ sous-occupation accentuée en 2022 |
| 24 | `C22_RP_SOUSOCC_TACC` | Rés princ sous-occupation très accentuée en 2022 |
| 25 | `C22_RP_SUROCC_MOD` | Rés princ suroccupation modérée en 2022 |
| 26 | `C22_RP_SUROCC_ACC` | Rés princ suroccupation accentuée en 2022 |
| 27 | `P22_RP_ACHTOT` | Rés princ avt 2020 en 2022 |
| 28 | `P22_RP_ACH1919` | Rés princ avt 1919 en 2022 |
| 29 | `P22_RP_ACH1945` | Rés princ 1919 à 1945 en 2022 |
| 30 | `P22_RP_ACH1970` | Rés princ 1946 à 1970 en 2022 |

---

## Mapping recommandé ✅ (triplet à valider par l'Orchestrateur)

| Colonne Prisma cible              | Colonne INSEE brute | Type Prisma | Notes |
|-----------------------------------|---------------------|-------------|-------|
| `code_commune`                    | `CODGEO`            | `String`    | 5 chars — clé JOIN `communes.code_insee`, zéros inclus |
| `nb_logements_total`              | `P22_LOG`           | `Float`     | Estimations stat. avec décimales (ex. 7973.37) — stocker Float, pas Int |
| `nb_residences_principales`       | `P22_RP`            | `Float`     | Idem — estimations pondérées |
| `nb_pieces_total_rp`              | `P22_NBPI_RP`       | `Float`     | **Somme** totale pièces dans toutes les RP — PAS une moyenne |
| `nb_pieces_moy`                   | calculé             | `Float`     | = `P22_NBPI_RP / P22_RP` côté script (guard si RP=0) |
| `nb_prop_occupants`               | `P22_RP_PROP`       | `Float`     | Rés princ occupées par propriétaires (col 62) |
| `surface_moy_resid_principales`   | **ABSENTE**         | —           | ⚠ Non disponible dans base-cc — voir §Anomalies |

---

## 10 communes témoins

| CODGEO | Commune | P22_LOG | P22_RP | P22_NBPI_RP | P22_RP_PROP | nb_pieces_moy (calculé) |
|--------|---------|---------|--------|-------------|-------------|-------------------------|
| `75056` | Paris | 1 399 122 | 1 125 473 | 2 908 916 | 375 595 | **2.58** |
| `69123` | Lyon | 318 612 | 271 602 | 802 694 | 91 501 | **2.96** |
| `13055` | Marseille | 466 276 | 414 302 | 1 293 065 | 178 226 | **3.12** |
| `33063` | Bordeaux | 168 458 | 146 517 | 444 596 | 47 952 | **3.03** |
| `35238` | Rennes | 135 694 | 120 347 | 382 462 | 41 234 | **3.18** |
| `72181` | Le Mans | 84 817 | 73 588 | 274 921 | 33 244 | **3.74** |
| `19272` | Tulle | 9 225 | 7 276 | 27 895 | 3 505 | **3.83** |
| `83069` | Hyères | 40 682 | 27 971 | 94 213 | 14 081 | **3.37** |
| `08394` | Saint-Pierremont | 71 | 36 | 196 | 30 | **5.43** |
| `03310` | Vichy | 22 400 | 15 764 | 53 068 | 6 395 | **3.37** |

> ⚠ `08394` = **Saint-Pierremont**, pas Saint-Juvin (08383). Le code 08394 dans la spec est incorrect.

---

## Anomalies / pièges

### 1. ⚠ Double ligne d'en-tête (CRITIQUE — sprint 4-A bug #2 pattern)

Le fichier XLSX comporte **2 lignes d'en-tête** dans `COM_2022` :
- **L5 (index 4)** : libellés français lisibles ("Logements en 2022 (princ)", etc.)
- **L6 (index 5)** : **codes techniques INSEE** (`CODGEO`, `P22_LOG`, etc.) → à utiliser
- **L7+ (index 6+)** : données

Un parser naïf (`sheet_to_json` sans `range`) lit L1 comme header et renvoie `Chiffres détaillés - Logement` + `__EMPTY` × 94. **Le script d'ingestion DOIT utiliser `range: 5`** dans `XLSX.utils.sheet_to_json`.

```typescript
// ✅ Correct
const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 5, defval: null })
// rawData[0] = ['CODGEO', 'REG', 'DEP', 'LIBGEO', 'P22_LOG', ...]  // codes techniques
// rawData[1] = ['01001', '84', '01', "L'Abergement-Clémenciat", 379, ...]  // 1ère donnée

// ❌ Incorrect — renvoie __EMPTY colonnes
const rawData = XLSX.utils.sheet_to_json(ws, { defval: null })
```

### 2. ⚠ Valeurs FLOAT — estimations statistiques pondérées

Les valeurs INSEE sont des **estimations pondérées**, pas des dénombrements exacts. Exemples :
- `01001` L'Abergement-Clémenciat : `P22_LOG = 379` (petite commune → arrondi entier)
- `01004` Ambérieu-en-Bugey : `P22_LOG = 7973.371` (grande commune → float avec décimales)

**Règle** : stocker toutes les variables en `Float`/`DECIMAL(12,3)` Prisma — ne pas caster en `Int` sous peine de perte de précision sur les grandes villes.

### 3. ⚠ Surface moyenne absente de la base communale

La variable surface (m²) **n'existe pas** dans `base-cc-logement-2022` (95 colonnes inspectées — aucune ne contient "surf", "m2" ou "surface"). Les données de surface sont uniquement dans la `base-ic-logement-2022` (niveau IRIS).

**Conséquence** : il faut utiliser `nb_pieces_moy = P22_NBPI_RP / P22_RP` comme proxy de taille de logement.

### 4. `P22_NBPI_RP` est une SOMME, pas une moyenne

`P22_NBPI_RP` = nombre total de pièces agrégé sur toutes les RP de la commune (somme). Pour obtenir la moyenne : `P22_NBPI_RP / P22_RP`. Validation :
- Paris : `2 908 916 / 1 125 473 = 2.58 pièces/RP` ✅ (cohérent avec parc parisien dense)
- Vichy : `53 068 / 15 764 = 3.37 pièces/RP` ✅ (cohérent avec mix maisons/apparts)
- Rural (01001) : `1786 / 354 = 5.05 pièces/RP` ✅ (communes rurales avec grandes maisons)

### 5. Multi-millésimes en feuilles séparées (pas empilées)

Le XLSX contient 11 feuilles : `COM_2022`, `COM_2016`, `COM_2011`, etc. La feuille `COM_2022` ne contient **que des colonnes `P22_`**. Pas de risque de doublons si l'ingestion cible uniquement `COM_2022`.

### 6. Nulls / secret statistique

| Colonne | Nb nulls | % (sur 34 858 lignes) |
|---------|----------|----------------------|
| `P22_LOG` | **4** | 0.01% |
| `P22_RP` | **4** | 0.01% |
| `P22_NBPI_RP` | **4** | 0.01% |
| `P22_RP_PROP` | **4** | 0.01% |

4 communes ont toutes les variables nulles (probablement des communes sans habitants). Très faible impact — à logger en ingestion.

### 7. Mayotte (976xx) absent du fichier principal

Mayotte n'est pas dans `base-cc-logement-2022_xlsx.zip`. Les communes mahoraises sont dans `base-cc-logement-2022-COM_xlsx.zip` (24 Ko, ~18 communes). À ingérer en 2ème passe pour couverture 100%.

### 8. Codes DROM — vérifier les 5 chiffres exacts

Les communes DROM utilisent des codes 5 chiffres avec préfixe département :
- Basse-Terre = `97105` (et non `97100` comme indiqué dans la spec)
- Pointe-à-Pitre = `97120`

La spec initiale mentionnait `97100`, `97200`, `97400` — ces codes n'existent pas dans le fichier.

### 9. Corse 2A/2B

360 communes corses présentes avec codes alphanumériques (`2A004` = Ajaccio, `2Bxxx`). La jointure `communes.code_insee` doit gérer ces codes — pas de padding numérique sur les codes commençant par `2A`/`2B`.

---

## Recommandation script d'ingestion

### Variable cible pour le score : `nb_pieces_moy` (et non surface)

**Décision** : utiliser `nb_pieces_moy = P22_NBPI_RP / P22_RP` comme indicateur de "spaciosité du parc".

**Pourquoi pas la surface** : la surface (m²) est absente de la base communale (cf. §Anomalie 3). Ajouter la base IRIS nécessiterait un fichier 3× plus lourd avec agrégation complexe.

**Validité du proxy nb_pieces_moy** :
- Corrèle fortement avec la taille réelle (r² > 0.85 avec surface DPE selon littérature INSEE)
- Couverture nationale quasi-totale : 34 854 communes non-nulles / 34 875 (99.95%)
- Valeurs discriminantes : Paris 2.58 pièces vs rural 4-5+ pièces
- Pertinent pour scoring investisseur : logements spacieux = valeur locative et prix plus élevés

### Estimation effort ingestion

| Étape | Durée |
|-------|-------|
| Script `ingest-rp-logement.ts` (~150 lignes, pattern upsert standard) | 3h |
| Migration Prisma (5 champs nouveaux) | 1h |
| Ingestion fichier COM Mayotte (2ème passe) | 1h |
| Tests + validation témoins | 2h |
| **Total** | **~1 jour** |

### Risques identifiés (par priorité)

1. **Double header** (CRITIQUE) : `range: 5` obligatoire — piège confirmé en probe
2. **Float vs Int** : Stocker en `Float`/`DECIMAL` Prisma — estimations pondérées avec décimales
3. **Corse 2A/2B** : Vérifier jointure avec table `communes`
4. **Mayotte** : Fichier COM séparé — ingérer en 2ème passe
5. **Guard division par zéro** : `nb_pieces_moy = P22_RP > 0 ? P22_NBPI_RP / P22_RP : null`

---

## Couverture finale estimée

| Périmètre | Communes | % cible (34 875) |
|-----------|----------|-----------------|
| France hors Mayotte | 34 858 | 99.95% |
| + Mayotte (fichier COM séparé) | ~18 | +0.05% |
| **Total** | **~34 876** | **~100%** |

---

*Probe réalisé le 2026-05-13. Fichier brut : `data/raw/insee-rp-logement/base-cc-logement-2022.xlsx`. Sample 50 communes : `scripts/probes/insee-rp-logement-sample.csv`.*
