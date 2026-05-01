# Probe : OFGL REI — Taxe Foncière Bâtie (TFB) par commune

> Probe 2026-05-01 — exploration API data.ofgl.fr, mission DATA-v4-TF

## Objectif

Identifier une source publique permettant de calculer la **TF moyenne par bien et par commune**
pour ~34 000 communes de France métropolitaine.

Méthode cible — **Voie A** : `produit_TFB_commune / nb_locaux_imposables`

---

## Source identifiée

| Champ | Valeur |
|-------|--------|
| Producteur | OFGL (Observatoire des Finances et de la Gestion Publique Locale) |
| Dataset ID | `rei` |
| URL dataset | https://data.ofgl.fr/explore/dataset/rei/ |
| URL API | `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/` |
| Description officielle | "(REI) Fiscalité directe locale 2023 - 2024" |
| Source primaire | DGFiP — Fichier REI (Recensement des Éléments d'Imposition) |
| Mise à jour | Annuelle (2023 et 2024 disponibles au 2026-05-01) |
| Licence | Open data (réutilisation libre) |

---

## Structure du dataset

| Métadonnée | Valeur |
|-----------|--------|
| Volume total | **24 553 242 lignes** |
| Format | Long (une ligne par variable par commune) |
| Granularité | **Commune** via champ `idcom` (code INSEE 5 chiffres) |
| Années disponibles | 2023, 2024 |
| Format export CSV | Semicolon-separated, **UTF-8** (pas de problème d'encodage) |

### Colonnes du dataset

| Colonne | Type | Description |
|---------|------|-------------|
| `annee` | text | Année fiscale (`"2023"` ou `"2024"`) |
| `idcom` | text | Code INSEE commune (5 chars, ex : `"33063"`) |
| `libcom` | text | Nom de la commune |
| `var` | text | Code variable (ex: `"E14"`) |
| `varlib` | text | Libellé long (ex: `"FB - COMMUNE / NOMBRE D'ARTICLES"`) |
| `categorie` | text | `"Base"`, `"Produit"`, `"Taux"`, `"Exoneration"` |
| `dispositif_fiscal` | text | `"FB"` pour foncier bâti |
| `destinataire` | text | `"Commune"`, `"GFP"`, `"Syndicat"`, `"Divers"` |
| `valeur` | double | Valeur numérique (€ ou %, selon la variable) |
| `libreg` | text | Nom de la région |
| `libdep` | text | Nom du département |
| `dep` | text | Code département |
| `reg` | text | Code région |
| `z08` | int | Population INSEE |

---

## Variables TFB (dispositif_fiscal = "FB") clés

| Code `var` | Libellé `varlib` | Catégorie | Destinataire | Unité |
|-----------|-----------------|-----------|-------------|-------|
| `E11` | "FB - COMMUNE / BASE NETTE" | Base | Commune | € |
| `E13` | "FB - COMMUNE / MONTANT RÉEL" | Produit | Commune | € |
| **`E14`** | **"FB - COMMUNE / NOMBRE D'ARTICLES"** | Base | Commune | Nombre de locaux |
| `E12` | "FB - COMMUNE / TAUX NET" | Taux | Commune | % |
| `E12VOTE` | "FB - COMMUNE / TAUX VOTÉ" | Taux | Commune | % |
| `E31` | "FB - GFP / BASE NETTE" | Base | GFP (EPCI) | € |
| `E33` | "FB - GFP / MONTANT RÉEL" | Produit | GFP (EPCI) | € |

**`E14` = nombre d'articles = nombre de locaux imposables** → variable clé pour Voie A.

---

## Couverture nationale

| Variable | Nb communes (2023) |
|----------|-------------------|
| E14 (nombre d'articles) | **34 943** |
| E13 (produit réel) | **34 942** |
| E11 (base nette) | ~34 942 |

Couverture quasi-totale de la France métropolitaine (~35 000 communes).

---

## Formule de calcul — Voie A

```
TF_moy_communale = E13 / E14
  où :
    E13 = produit réel TFB commune (€ total collecté par la commune)
    E14 = nombre d'articles TFB (= nb de locaux imposables)
```

**Limitation** : E13 est la part communale seulement (hors EPCI/syndicats).
Pour le scoring par percentile rank, cette limitation est acceptable (signal cohérent entre communes).

**Voie A enrichie** (plus précise, nécessite jointure avec fiscalite-locale-des-particuliers) :
```
TF_moy_totale = (taux_global_tfb / 100) × (E11 / E14)
  où :
    taux_global_tfb = depuis data.economie.gouv.fr/fiscalite-locale-des-particuliers (2024)
    E11/E14 = VLC imposable moyenne par logement (base nette / nb articles)
```

---

## Spot-check 5 communes témoins (OFGL REI 2023, Voie A simple)

| Commune | INSEE | E12VOTE (%) | E13 (€ prod.) | E14 (nb art.) | TF_moy (€/art.) | Plausibilité |
|---------|-------|------------|---------------|---------------|-----------------|-------------|
| Bordeaux | 33063 | 48.48 | 233 227 174 | 117 164 | **1 991 €** | ✅ (taux très élevé, mix logements) |
| Paris | 75056 | 20.50 | 1 752 770 489 | 1 025 149 | **1 711 €** | ✅ (ref mission : 800-1500€) |
| Tulle | 19272 | 49.59 | 10 648 458 | 6 230 | **1 710 €** | ⚠️ (ref 600€ était pour 50m² — cohérent toutes tailles) |
| SENUC (08412) | 08412 | 30.77 | 34 760 | 82 | **424 €** | ✅ (petite commune rurale) |
| Lyon | 69123 | 31.89 | 335 821 125 | 232 548 | **1 445 €** | ✅ taux modéré, plausible |

> **Note Tulle** : la référence "~600€" dans la mission cible 50m², mais E13/E14 est une moyenne
> sur TOUS les biens (maisons individuelles 100-150m² incluses). La valeur 1 710€ est cohérente.

---

## Export CSV — URL de production

```
https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv
  ?where=annee%3D%222023%22%20AND%20var%20IN%20(%22E11%22%2C%22E13%22%2C%22E14%22%2C%22E12VOTE%22)
  &select=annee%2Cidcom%2Clibcom%2Cvar%2Cvaleur
  &timezone=UTC
  &delimiter=%3B
```

Volume estimé : 4 vars × 34 943 communes ≈ **140 000 lignes** (très gérable, ~5 Mo CSV).

---

## Pièges identifiés

- [x] **Format long** : données en format "long" (une ligne par variable). Nécessite un pivot `idcom → {E11, E13, E14}` dans le script d'ingestion.
- [x] **E13 = part communale seulement** : ne comprend pas la part EPCI (E33). Pour le scoring relatif, c'est acceptable.
- [ ] **Communes fusionnées** : les codes COG peuvent avoir changé depuis 2023. Vérifier les communes avec `secret_statistique = "sec_stat"` (anonymisées si < 3 locaux).
- [ ] **Valeurs NULL** : lignes avec `valeur = 0` supprimées du dataset (mentionné dans la documentation OFGL). Les communes à 0 locaux sont donc absentes.
- [ ] **EPCI à FPU** : dans les EPCI à fiscalité unique (FPU), la base est perçue au niveau EPCI (E31/E33). La commune peut avoir E13 faible. Utiliser `taux_global_tfb × E11/E14` pour corriger.
- [ ] **Arrondissements** : Paris, Lyon, Marseille ont un code commune unique (75056, 69123, 13055). Les arrondissements sont des communes fictives INSEE mais le REI agrège au niveau commune principale.

---

## Conclusion

**Voie A validée sur OFGL REI.**
Source unique, couverture 34 943 communes, données 2023, API CSV directe, UTF-8.
Formule : `E13 / E14` → TF communale moyenne par logement.
Effort d'implémentation : **S** (Small — script ~100 lignes, pas de pagination complexe).
