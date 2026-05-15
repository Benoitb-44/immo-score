# Probe : DGFiP Fiscalité Locale — Taux Taxe Foncière

> Probe manuel 2026-05-01 — analyse XLSX via SheetJS + scripts/probe-xlsx.ts (ZIP détecté = non parseable comme CSV)

## Objectif

Identifier le dataset DGFiP contenant le **taux de taxe foncière bâtie (TFB) par commune**,
variable `fiscalite.taux_foncier_bati` dans l'algorithme de score CityRank (poids 15%).

## Datasets explorés

### 1. data.gouv.fr — `impots-locaux` (source demandée)

| Champ | Valeur |
|-------|--------|
| URL dataset | `https://www.data.gouv.fr/fr/datasets/impots-locaux/` |
| Nb ressources | 47 |
| Mise à jour la plus récente | 2021-09-30 (données 2020) |
| Formats disponibles | ZIP (XLSX par région), XLS (niveaux dept/région), CSV (métadonnées vides) |

**Verdict : données obsolètes (2020), aucune mise à jour depuis 2021.**

### 2. data.economie.gouv.fr — API `impots-locaux0`

| Champ | Valeur |
|-------|--------|
| URL API | `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/impots-locaux0/exports/csv` |
| Colonnes retournées | `recordid`, `_record_id`, `record_timestamp`… (métadonnées uniquement) |
| Total records | **0** (dataset inopérant) |

**Verdict : dataset non fonctionnel via l'API publique.**

---

## Analyse détaillée du ZIP le plus récent (2020)

| Champ | Valeur |
|-------|--------|
| URL source | `https://static.data.gouv.fr/resources/impots-locaux/20210930-121834/fiscalite-directe-locale-deliberations-taux-2020.zip` |
| Taille | **32.0 Mo** |
| Contenu | **14 fichiers XLSX** (un par région) |

### Liste des fichiers dans le ZIP

```
deliberations_2020_communes_region_11.xlsx  (1.2 Mo — Île-de-France)
deliberations_2020_communes_region_24.xlsx  (1.7 Mo — Centre-Val de Loire)
deliberations_2020_communes_region_27.xlsx  (3.6 Mo — Bourgogne-Franche-Comté)
deliberations_2020_communes_region_28.xlsx  (2.6 Mo — Normandie)
deliberations_2020_communes_region_32.xlsx  (3.7 Mo — Hauts-de-France)
deliberations_2020_communes_region_44.xlsx  (5.0 Mo — Grand Est)
deliberations_2020_communes_region_52.xlsx  (1.2 Mo — Pays de la Loire)
deliberations_2020_communes_region_53.xlsx  (1.2 Mo — Bretagne)
deliberations_2020_communes_region_75.xlsx  (4.3 Mo — Nouvelle-Aquitaine)
deliberations_2020_communes_region_76.xlsx  (4.4 Mo — Occitanie)
deliberations_2020_communes_region_84.xlsx  (4.0 Mo — Auvergne-Rhône-Alpes)
deliberations_2020_communes_region_93.xlsx  (0.9 Mo — Provence-Alpes-Côte d'Azur)
deliberations_2020_communes_region_94.xlsx  (0.4 Mo — Corse)
deliberations_2020_communes_region_97.xlsx  (0.1 Mo — DOM)
+ 13 fichiers départements/régions (XLS)
```

### Structure du fichier XLSX (exemple : région 11 — Île-de-France)

| Métadonnée | Valeur |
|-----------|--------|
| Onglet unique | `COMMUNES` |
| Plage | `A1:JR1275` (**278 colonnes × 1275 lignes**) |
| Lignes d'en-tête | **6 lignes** (titre → section → sous-section → sous-sous-section → détail → détail niveau 2) |
| Lignes de données | À partir de la **ligne 8** |
| Communes Île-de-France | **1 268 communes** |

### Colonnes d'identification commune (colonnes 0–5)

| Col | Contenu | Exemple (Paris) | Exemple (Seine-et-Marne) |
|-----|---------|-----------------|--------------------------|
| 0 | Code département (2 chars + espaces) | `"75 "` | `"77 "` |
| 1 | Libellé département | `"PARIS + DRESG "` | `"SEINE-ET-MARNE "` |
| 2 | Code commune intra-dept (3 chars + espaces) | `"056 "` | `"001 "` |
| 3 | Libellé commune | `"VILLE DE PARIS "` | `"ACHERES LA FORET "` |
| 4 | SIREN du groupement | `"200054781 "` | `"200072346 "` |
| 5 | Libellé groupement | `"Métropole du Grand Paris "` | `"CA du Pays de Fontainebleau "` |

**Construction du code INSEE** : `DEP.trim().padStart(2,'0') + COM.trim().padStart(3,'0')` → 5 chars

### Problème structurel critique : mauvais fichier pour le taux TFB

Ce ZIP contient les **"Délibérations et taux votés par les collectivités locales"** —
un tableau de **278 colonnes** sur les délibérations fiscales détaillées
(exemptions zones de revitalisation, hôtels, jeunes entreprises innovantes, abattements TH, etc.).

**Ce fichier NE contient PAS directement la colonne "taux TFB voté global".**

> La section "DÉLIBÉRATIONS EN MATIERE DE TAXE FONCIERE SUR LES PROPRIETES BATIES"
> commence à la colonne 23 et contient des délibérations d'exemptions et abattements,
> pas le taux TFB de base voté par la commune.

Le taux TFB global est dans la publication DGFiP distincte :
**"Bases et taux de la fiscalité directe locale"** (fichier REI à proprement parler).

---

## Sources alternatives à explorer

| Source | URL à tester | Probabilité de succès |
|--------|-------------|----------------------|
| OFGL — Observatoire des finances locales | `https://www.ofgl.fr/statistiques` | ★★★★ (publie CSV annuel commune) |
| DGCL — Collectivités locales | `https://www.collectivites-locales.gouv.fr/statistiques-et-donnees-locales` | ★★★ |
| DGFiP open data direct | `https://www.impots.gouv.fr/portail/node/14226` | ★★ (accès restreint) |
| data.gouv.fr search "bases taux fiscalite directe locale" | À tester | ★★ |

---

## Pièges identifiés (pour implémentation future)

- [x] **Mauvais type de fichier** — le ZIP `impots-locaux` contient des délibérations, pas les taux TFB. Chercher le fichier "bases et taux".
- [ ] **Codes communes historiques pré-fusion** — DGFiP utilise parfois les codes INSEE d'avant les fusions de communes. Nécessite table de correspondance COG.
- [ ] **Espaces trailing dans les codes** — codes département et commune ont des espaces (`"75 "`, `"056 "`). Trim obligatoire.
- [ ] **6 lignes d'en-têtes** — fusion de cellules, index de colonnes instables entre fichiers régionaux. Parser fragile, index hard-codés déconseillés.
- [ ] **Arrondissements** — Paris (01–20), Lyon, Marseille ont des lignes par arrondissement. Agréger au niveau commune INSEE si nécessaire.
- [ ] **EPCI à FPU** — dans les communautés de communes à fiscalité professionnelle unique, le taux TFB peut être au niveau EPCI. Logique de fallback nécessaire.
- [ ] **Réforme fiscale 2021** — suppression TH résidences principales a changé les structures de publication DGFiP. Données 2022+ dans formats différents.
- [ ] **Granularité nationale** — 14 fichiers ZIP à merger pour couvrir les ~35 000 communes métropolitaines.

---

## Recommandations pour session suivante

### Option A — Source OFGL 2023 (recommandée)
Explorer `https://www.ofgl.fr` — l'Observatoire des finances locales publie annuellement
les taux de taxe foncière par commune en CSV téléchargeable.
Données 2023 probablement disponibles.
**Effort estimé :** faible si CSV standard.

### Option B — ZIP délibérations 2020 (quick win, données 2020)
Ingérer les 14 fichiers XLSX du ZIP existant en parsant les colonnes correctes.
Utiliser les taux de 2020 (variation faible d'une année à l'autre pour TFB).
**Effort estimé :** moyen (14 XLSX × 278 colonnes × 6 lignes d'en-têtes).

### Option C — Déprioriser pour Sprint 4-B
La dimension fiscalité (poids 15%) peut rester à NULL.
L'algorithme renormalise sur les dimensions disponibles (DVF 45%, BPE 20%, DPE 10%, Risques 25% → total 100%).
**Effort estimé :** zéro. À revisiter en Sprint 4-C.

---

## Prochaine étape

1. **En session suivante** : tester OFGL + DGCL pour données 2023
2. Si source 2023 trouvée → rédiger spec ingestion `DATA-v4-TF`
3. Sinon → décider entre Option B (2020) ou Option C (déprioriser)
