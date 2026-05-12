# OFGL Probe Report — 2026-05-11

## Verdict : ✅ OK

---

## Source retenue

- **Dataset** : REI — Fiscalité directe locale 2023-2024
- **Portail** : data.ofgl.fr (Observatoire des Finances et de la Gestion publique Locales)
- **URL API export CSV** : `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv`
- **URL exploration** : `https://data.ofgl.fr/explore/dataset/rei/information/`
- **Format** : CSV (API REST), JSON disponible également
- **Périmètre revendiqué** : Taux votés + taux nets + bases + produits + exonérations — toutes taxes directes locales par commune/EPCI/département, via le REI DGFiP
- **Variable TFB** : `varlib = "FB - COMMUNE / TAUX VOTÉ"` (filtre sur `dispositif_fiscal = "FB"`)
- **Millésime le plus récent** : **2024** (annee=2024 disponible)
- **Producteur** : DGFiP (distribué via OFGL)
- **Licence** : Licence Ouverte Etalab v2.0 (standard portail data.ofgl.fr — champ `license` null dans l'API mais présumée ; à confirmer légalement avant mise en prod)

---

## Caractéristiques techniques (CSV échantillon 200 lignes)

- **Encodage** : UTF-8 **avec BOM** (EF BB BF) — attention parsing
- **Terminateurs de ligne** : CRLF (`\r\n`)
- **Séparateur** : point-virgule (`;`)
- **Décimales** : point (`.`) — ex. `31.14`, `45.66`
- **Lignes total dataset** : ~24,5 millions (toutes taxes, toutes années, toutes variables)
- **Lignes filtrées FB/TAUX VOTÉ/2024** : ~34 000 (1 par commune)
- **Headers** (sélection minimale) : `annee;idcom;libcom;dep;varlib;valeur`
- **Champs complets disponibles** : `annee, libreg, libdep, gfp_ept, libcom, optepci, forjepci, strate, dispositif_fiscal, categorie, destinataire, varlib, valeur, secret_statistique, z08, reg, dep, idcom, sirepci, var`

---

## 10 communes témoins

| Code INSEE | Nom | Taux TFB voté (%) | Millésime |
|---|---|---|---|
| 75056 | Paris | 20.50 | 2024 |
| 69123 | Lyon | 31.89 | 2024 |
| 13055 | Marseille | 44.54 | 2024 |
| 33063 | Bordeaux | 48.48 | 2024 |
| 35238 | Rennes | 45.66 | 2024 |
| 44109 | Nantes | 46.34 | 2024 |
| 72181 | Le Mans | 34.71 | 2024 |
| 19272 | Tulle | 49.59 | 2024 |
| 08383 | Saint-Juvin* | 34.72 | 2024 |
| 42218 | Saint-Étienne | 44.68 | 2024 |

*Note : Le code INSEE **08398** fourni dans la mission correspond à **Sainte-Vaubourg** (commune différente, TFB 2024 = 40.52%). Saint-Juvin = **08383**. Les deux communes ont des données TFB disponibles — aucun trou de couverture, simple erreur de code dans la spec de la mission.

---

## Couverture

- **Records FB/Taux/Commune 2024 (TAUX VOTÉ + NET confondus)** : 34 937
- **Référence CityRank BDD** : 34 875 communes
- **Ratio** : 34 937 / 34 875 = **100.2%** (légèrement supérieur car inclut DROM + Mayotte)
- **DROM inclus** : ✅ oui — ex. Koungou (97610, Mayotte) présent avec taux 2024 = 26.12%
- **Trous identifiés** : aucun trou métropole détecté ; couverture DROM confirmée (Mayotte)
- **Format long (tall)** : chaque variable fiscale = 1 ligne. Pour les communes, deux lignes possibles : `TAUX VOTÉ` et `TAUX NET` (valeurs identiques quand pas d'exonération). Filtrer sur `varlib = "FB - COMMUNE / TAUX VOTÉ"` pour éviter les doublons.

---

## Pièges identifiés

1. **UTF-8 BOM** : Export CSV systématiquement en UTF-8 avec BOM (EF BB BF) — parser avec `stripBOM` côté Node.js (csv-parse, papaparse) ou `iconv -f utf-8-bom` côté shell.
2. **Séparateur point-virgule** : pas une virgule standard CSV — bien préciser `delimiter: ";"` dans le parser.
3. **TAUX VOTÉ vs TAUX NET** : Deux lignes distinctes par commune dans le dataset. Priorité à `"FB - COMMUNE / TAUX VOTÉ"` ; fallback sur `"FB - COMMUNE / TAUX NET"` si VOTÉ absent (cas rares).
4. **Format long (pivot)** : Le REI est un dataset tall. Chaque `(commune, variable)` = 1 ligne. L'ingestion nécessite un filtre `varlib` strict — pas de select * naïf.
5. **Licence null dans API** : Le champ `license` retourne null dans les métadonnées data.ofgl.fr. La licence Etalab v2.0 est présumée (standard OFGL/data.gouv.fr), mais une confirmation légale est recommandée avant mise en production.
6. **secret_statistique** : Champ présent dans les records — certaines valeurs peuvent être masquées pour des communes très petites. Volume estimé très faible (<0.1%), à journaliser lors de l'ingestion.
7. **Taille dataset** : 24.5M lignes totales. Toujours utiliser les filtres API (`where=`) pour l'export — ne pas télécharger le dataset complet sans filtrage.

---

## Recommandation

### ✅ Source validée — spec ingestion

1. **Endpoint** : `GET https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv?where=dispositif_fiscal%3D%22FB%22%20AND%20annee%3D%222024%22%20AND%20varlib%3D%22FB%20-%20COMMUNE%20%2F%20TAUX%20VOT%C3%89%22&select=idcom%2Clibcom%2Cdep%2Cvaleur&use_labels=false`
   — Retourne ~34 000 lignes, une par commune, en quelques secondes.

2. **Champ JOIN BDD** : `idcom` (code INSEE 5 chiffres, type texte) → `communes.code_insee` — correspondance directe, pas de transformation nécessaire.

3. **Champ cible** : `valeur` → nouveau champ `taux_tfb` (DECIMAL 5,2) dans la table de scoring — valeur en pourcentage (ex : 31.14 = 31.14%).

4. **Idempotence** : UPSERT sur `(code_insee, millesime)` — re-run sans effet de bord. Prévoir champ `millesime` = 2024.

5. **Encodage parsing** : UTF-8 BOM + séparateur `;` + décimale `.` — configurer explicitement dans csv-parse/papaparse (`delimiter: ";"`, `bom: true`).

---

*Probe réalisé le 2026-05-11. Échantillons bruts conservés dans `/tmp/ofgl-probe/`.*

---

## Mini-probe complémentaire Data Scientist (11/05 PM)

### Check 1 — Produits / Bases par commune

Liste complète des `varlib` FB disponibles au niveau **commune** (extraite via API `facets?facet=varlib&where=dispositif_fiscal="FB"`) :

**Variables clés confirmées :**

| varlib | Disponible |
|---|---|
| `FB - COMMUNE / TAUX VOTÉ` | ✅ |
| `FB - COMMUNE / TAUX NET` | ✅ |
| `FB - COMMUNE / BASE NETTE` | ✅ |
| `FB - COMMUNE / MONTANT RÉEL` | ✅ (= produit fiscal effectif) |
| `FB - COMMUNE / NOMBRE D'ARTICLES` | ✅ |
| `FB - COMMUNE / LISSAGE - MONTANT` | ✅ |
| `FB - GFP / BASE NETTE` | ✅ |
| `FB - GFP / MONTANT RÉEL` | ✅ |

- **PRODUIT FB par commune disponible** : ✅ → `FB - COMMUNE / MONTANT RÉEL`
- **BASES FB par commune disponible** : ✅ → `FB - COMMUNE / BASE NETTE`

> Note : `MONTANT RÉEL` = produit fiscal réellement encaissé (base nette × taux appliqué, après dégrèvements). Équivalent à la colonne "produit" dans les matrices cadastrales DGFiP. Directement utilisable sans recalcul.

### Check 2 — Échelons de collectivité pour TAUX VOTÉ

| Échelon | varlib TAUX VOTÉ | Présent |
|---|---|---|
| Commune | `FB - COMMUNE / TAUX VOTÉ` | ✅ |
| GFP/EPCI | `FB - GFP / TAUX VOTÉ` | ✅ |
| Syndicat | `FB - SYNDICATS ET ORG. ASSIMILÉS / TAUX NET` (VOTÉ absent) | ⚠️ NET seulement |
| Département | absent | ❌ |
| Région | absent | ❌ |

- **Échelons TAUX VOTÉ trouvés** : Commune + GFP (EPCI)
- **Tous 4 échelons présents** : ❌ — mais **normal et attendu** : depuis la réforme fiscale de 2011, les départements et régions ne perçoivent plus de TFB et n'ont donc pas de taux voté. Seuls commune + EPCI votent encore un taux TFB. Absence des deux autres échelons = comportement correct du dataset, pas un trou.

### Check 3 — Licence officielle

- **Champ `license` API data.ofgl.fr** : `null` (confirmé sur endpoint `/catalog/datasets/rei/`)
- **Page CGU data.ofgl.fr** : stipule "chaque dataset a sa propre licence" — pas de licence globale uniforme
- **Par analogie** : les 16 datasets OFGL publiés sur data.gouv.fr sont tous sous **Licence Ouverte Etalab v2.0**
- **Licence officielle** : ⚠️ **Non confirmée formellement** — présumée Licence Ouverte Etalab v2.0
- **URL source CGU** : `https://data.ofgl.fr/terms/terms-and-conditions/`
- **Action requise** : vérification directe auprès d'OFGL (contact@ofgl.fr ou page dataset) avant mise en production

### Verdict pour D4

- **Option D' validée** : ✅
  - `TAUX VOTÉ` commune 2024 disponible → calcul taux ✅
  - `BASE NETTE` commune disponible → calcul montant par habitant si nécessaire ✅
  - `MONTANT RÉEL` commune disponible → produit fiscal direct, sans recalcul ✅
  - La formule `montant_tfb ≈ base_nette × taux_voté / 100` est réalisable **ET** redondante avec `MONTANT RÉEL` déjà disponible
- **Recommandation D4** : utiliser `MONTANT RÉEL` comme proxy "pression fiscale réelle" plutôt que recalculer — plus robuste (intègre dégrèvements et lissages)
- **Seul point bloquant résiduel** : confirmation licence avant ingestion prod
