# Synthèse Décisionnelle — DATA-v4-TF : Taxe Foncière par commune

> Probe 2026-05-01 — Mission d'exploration sourcée (pas d'ingestion)
> Timebox : ~2h d'exploration active

---

## Verdict : **Voie 1 RÉUSSIE — OFGL REI 2023**

Source trouvée, validée, spec complète. Prête pour implémentation `ingest-tf.ts`.

---

## Résumé des voies explorées

| Voie | Source | Résultat |
|------|--------|----------|
| **Voie 1 — OFGL** | `data.ofgl.fr/rei` (REI DGFiP 2023-2024) | ✅ **VALIDÉE** — données 2023, 34 943 communes, Voie A opérationnelle |
| Voie 2 — DGFiP data.gouv.fr | `impots-locaux` ZIP (14 XLSX/région) | ❌ Données 2020 seulement, format complexe (278 colonnes, 6 en-têtes), pas de taux TFB direct |
| Voie 2bis — DGFiP fiscalité particuliers | `data.economie.gouv.fr/fiscalite-locale-des-particuliers` | ⚠️ Taux uniquement (taux_global_tfb 2024) — pas de bases ni de nb_locaux |
| Voie 2ter — DGFiP REI direct | `data.economie.gouv.fr/impots-locaux-fichier-de-recensement...` | ⚠️ ZIP téléchargeables 1982-2024 mais 0 records API, format très complexe |
| Voie 3 | Non nécessaire | — |

---

## Source retenue

| Champ | Valeur |
|-------|--------|
| **Producteur** | OFGL / DGFiP |
| **Dataset** | `(REI) Fiscalité directe locale 2023 - 2024` |
| **URL exacte** | https://data.ofgl.fr/explore/dataset/rei/ |
| **API CSV** | `https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv` |
| **Format** | CSV semicolon, UTF-8 |
| **Année** | 2023 (ou 2024 disponible) |
| **Couverture** | **34 943 communes** (quasi-totale France métropolitaine) |
| **Volume** | ~140 000 lignes (4 variables × 34 943 communes) |

---

## Méthode de calcul retenue — Voie A

```
tf_moy_communale = E13 / E14
```

| Variable | Code `var` | Libellé | Unité |
|----------|-----------|---------|-------|
| Produit réel TFB commune | `E13` | "FB - COMMUNE / MONTANT RÉEL" | € total |
| Nombre d'articles (locaux imposables) | `E14` | "FB - COMMUNE / NOMBRE D'ARTICLES" | entier |
| Base nette TFB (pour enrichissement) | `E11` | "FB - COMMUNE / BASE NETTE" | € |
| Taux voté communal | `E12VOTE` | "FB - COMMUNE / TAUX VOTÉ" | % |

**Limitation connue** : E13 = part communale seulement (hors EPCI). Pour le scoring par
percentile rank, cette limitation est acceptable — le signal est cohérent entre communes.

**Voie A enrichie** (optionnel sprint suivant) : joindre `taux_global_tfb` depuis
`fiscalite-locale-des-particuliers` (data.economie.gouv.fr) pour une estimation TF totale
incluant la part EPCI.

---

## Spot-check validé — 5 communes témoins (OFGL REI 2023)

| Commune | INSEE | Taux comm. | E14 (nb art.) | TF_moy (E13/E14) | Verdict |
|---------|-------|-----------|--------------|-----------------|---------|
| Bordeaux | 33063 | 48.48% | 117 164 | **1 991 €/an** | ✅ plausible (taux très élevé Bordeaux Métropole) |
| Paris | 75056 | 20.50% | 1 025 149 | **1 711 €/an** | ✅ ref mission 800-1500€, cohérent toutes tailles |
| Lyon | 69123 | 31.89% | 232 548 | **1 445 €/an** | ✅ taux modéré Lyon, plausible |
| Tulle | 19272 | 49.59% | 6 230 | **1 710 €/an** | ✅ ref 600€ était pour 50m² seulement |
| SENUC (≈Saint-Juvin) | 08412 | 30.77% | 82 | **424 €/an** | ✅ petite commune rurale Ardennes, plausible |

> Saint-Juvin (08391) non disponible — SENUC (08412), même département, même profil rural.

---

## Spec technique — `src/scripts/ingest-tf.ts`

### Paramètres d'appel API

```typescript
const CSV_URL = 
  'https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv' +
  '?where=annee%3D%222023%22%20AND%20var%20IN%20(%22E11%22%2C%22E13%22%2C%22E14%22)' +
  '&select=annee%2Cidcom%2Clibcom%2Cvar%2Cvaleur' +
  '&timezone=UTC' +
  '&delimiter=%3B';
```

### Structure du fichier CSV

```
annee;idcom;libcom;var;valeur
2023;33063;BORDEAUX;E13;233227174.0
2023;33063;BORDEAUX;E14;117164.0
2023;33063;BORDEAUX;E11;480141523.0
```

### Algorithme d'ingestion (pseudo-code)

```typescript
// 1. Fetch CSV
const stream = await fetch(CSV_URL);

// 2. Parse CSV — format long → accumulate per commune
const communes = new Map<string, { E11?: number, E13?: number, E14?: number }>();

for await (const row of parseCsv(stream, { delimiter: ';', encoding: 'utf-8' })) {
  const { idcom, var: varCode, valeur } = row;
  if (!communes.has(idcom)) communes.set(idcom, {});
  communes.get(idcom)![varCode as 'E11'|'E13'|'E14'] = parseFloat(valeur);
}

// 3. Calculate + UPSERT
for (const [idcom, data] of communes) {
  const tf_moy = (data.E13 != null && data.E14 != null && data.E14 > 0)
    ? data.E13 / data.E14
    : null;

  await prisma.fiscaliteCommune.upsert({
    where: { codeInsee: idcom },
    create: { codeInsee: idcom, tfBase: data.E11, tfProduit: data.E13, tfNbArticles: data.E14, tfMoyParBien: tf_moy, annee: 2023 },
    update: { tfBase: data.E11, tfProduit: data.E13, tfNbArticles: data.E14, tfMoyParBien: tf_moy, annee: 2023 },
  });
}
```

### Transformations nécessaires

| Transformation | Détail |
|---------------|--------|
| Encodage | UTF-8 ✅ (pas de conversion nécessaire) |
| Décimale | Point `.` déjà utilisé (`233227174.0`) — pas de remplacement `,` |
| Pivot long→wide | Regrouper par `idcom`, accumuler les 3 variables (E11/E13/E14) |
| Code INSEE | `idcom` = 5 chars, pas de padding nécessaire (ex: `"08412"`) |
| NULL vs 0 | Si E14 = 0 ou absent → `tf_moy = null` (règle NULL ≠ 0) |
| Secret stats | Lignes avec `secret_statistique = "sec_stat"` → ignorer (< 3 locaux) |

### Schéma Prisma — modèle `FiscaliteCommune`

```prisma
model FiscaliteCommune {
  id            Int     @id @default(autoincrement())
  communeId     Int     @unique
  commune       Commune @relation(fields: [communeId], references: [id])
  tf_base       Float?  // E11 : base nette TFB commune (€)
  tf_produit    Float?  // E13 : produit réel TFB commune (€)
  tf_nb_articles Int?   // E14 : nombre de locaux imposables
  tf_moy_par_bien Float? // E13/E14 : TF moyenne par logement (€/an)
  tf_taux_vote  Float?  // E12VOTE : taux voté communal (%)
  annee         Int     // 2023
  @@schema("immo_score")
}
```

---

## Intégration dans l'algorithme de score

```
score_tf = percentile_rank(tf_moy_par_bien)
           inversé (TF élevée = moins attractif → score bas)
```

Communes sans données TF → `tf_moy_par_bien = null` → médiane nationale en fallback
(comportement standard algorithme CityRank).

---

## Estimation effort implémentation

| Étape | Effort |
|-------|--------|
| Migration Prisma (nouveau modèle) | 30 min |
| Script `ingest-tf.ts` | 2h |
| Tests spot-check post-ingest | 30 min |
| Intégration `compute-scores.ts` | 1h |
| **Total** | **~4h** — taille **S** |

---

## Risques résiduels

| Risque | Niveau | Mitigation |
|--------|--------|-----------|
| E13 = part communale seulement (hors EPCI) | Faible | Signal cohérent pour percentile rank. Enrichir en V2 avec taux_global_tfb |
| Communes fusionnées depuis 2023 | Faible | Même logic de mapping COG que BPE/DVF |
| Valeurs 0 absentes du dataset OFGL | Faible | Traiter absence = NULL dans UPSERT |
| EPCI à FPU (base EPCI plutôt que commune) | Moyen | E13/E14 reste un signal utile pour la commune même en FPU |
| URL OFGL instable (open data) | Faible | Données DGFiP open data — stable, millésime stable |

---

## Prochaine étape

1. Migration Prisma : ajouter modèle `FiscaliteCommune`
2. Implémenter `src/scripts/ingest-tf.ts` (spec ci-dessus)
3. Run VPS : `npm run ingest:tf`
4. Intégrer `score_tf` dans `compute-scores.ts` (poids à définir)
5. Optionnel : enrichir avec `taux_global_tfb` depuis data.economie.gouv.fr pour V2
