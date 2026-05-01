# Probe : Carte Loyers 2023 (ANIL/Cerema)

> Généré le 2026-05-01 07:18:24 par `scripts/probe-xlsx.ts`

## Source

| Champ | Valeur |
|-------|--------|
| URL appelée | `data/cartes-loyers/current/pred-mai-mef-dhup.csv` |
| URL finale (après redirect) | `data/cartes-loyers/current/pred-mai-mef-dhup.csv` |
| Fichier local | `pred-mai-mef-dhup.csv` |

## Méta-fichier

| Métadonnée | Valeur |
|-----------|--------|
| Format | CSV |
| Taille | 4.8 Mo |
| Encodage | Latin-1/Windows-1252 |
| Séparateur CSV | point-virgule (;) |
| Nb lignes (hors en-tête) | **34 970** |
| Nb colonnes | **13** |
| Colonne code INSEE détectée | `INSEE_C` |
| Communes uniques (code INSEE) | **34 970** |

## En-têtes (13 colonnes)

| # | Nom de colonne |
|---|----------------|
| 1 | `id_zone` |
| 2 | `INSEE_C` |
| 3 | `LIBGEO` |
| 4 | `EPCI` |
| 5 | `DEP` |
| 6 | `REG` |
| 7 | `loypredm2` |
| 8 | `lwr.IPm2` |
| 9 | `upr.IPm2` |
| 10 | `TYPPRED` |
| 11 | `nbobs_com` |
| 12 | `nbobs_mail` |
| 13 | `R2_adj` |

## Échantillon (10 premières lignes)

| id_zone | INSEE_C | LIBGEO | EPCI | DEP | REG | loypredm2 | lwr.IPm2 | upr.IPm2 | TYPPRED | nbobs_com | nbobs_mail | R2_adj |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 52165 | Dancevoir | 245200597 | 52 | 44 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 15 | 473 | 0,716929797607486 |
| 1 | 21115 | Buncey | 242101434 | 21 | 27 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 24 | 473 | 0,716929797607486 |
| 1 | 21154 | Châtillon-sur-Seine | 242101434 | 21 | 27 | 7,61249180315074 | 5,8352077072778 | 9,93110003278216 | commune | 221 | 473 | 0,716929797607486 |
| 1 | 52526 | Villars-Santenoge | 200027308 | 52 | 44 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 3 | 473 | 0,716929797607486 |
| 1 | 21519 | Recey-sur-Ource | 242101434 | 21 | 27 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 10 | 473 | 0,716929797607486 |
| 1 | 21526 | Rochefort-sur-Brévon | 242101434 | 21 | 27 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 0 | 473 | 0,716929797607486 |
| 1 | 21706 | Villotte-sur-Ource | 242101434 | 21 | 27 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 0 | 473 | 0,716929797607486 |
| 1 | 52138 | Colmier-le-Haut | 200027308 | 52 | 44 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 0 | 473 | 0,716929797607486 |
| 1 | 52540 | Vitry-en-Montagne | 200027308 | 52 | 44 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 0 | 473 | 0,716929797607486 |
| 1 | 52016 | Arbot | 200027308 | 52 | 44 | 6,29469619945702 | 4,82499769499072 | 8,2120661497093 | maille | 0 | 473 | 0,716929797607486 |

## Stats colonnes clés (nulls + échantillon valeurs)

| Colonne | Nb nulls | Exemple valeurs |
|---------|----------|-----------------|
| `id_zone` | 0 | `1`, `10`, `100` |
| `INSEE_C` | 0 | `52165`, `21115`, `21154` |
| `LIBGEO` | 0 | `Dancevoir`, `Buncey`, `Châtillon-sur-Seine` |
| `EPCI` | 0 | `245200597`, `242101434`, `200027308` |
| `DEP` | 0 | `52`, `21`, `62` |
| `R2_adj` | 0 | `0,716929797607486`, `0,681098044233012`, `0,753955531265784` |

## Colonnes cibles pour l'ingestion

| Colonne source | Rôle | Type Prisma cible | Notes |
|----------------|------|-------------------|-------|
| `INSEE_C` | code INSEE commune | `String` | 5 chars, pas de padding nécessaire |
| `loypredm2` | loyer médian prédit €/m² | `Float?` | décimale `,` → remplacer par `.` avant parse |
| `lwr.IPm2` | borne inférieure IC 95% | `Float?` | même traitement décimal |
| `upr.IPm2` | borne supérieure IC 95% | `Float?` | même traitement décimal |
| `TYPPRED` | niveau de prédiction | `String?` | `"commune"` ou `"maille"` |
| `nbobs_com` | nb annonces au niveau commune | `Int?` | 0 si estimation par maille |
| `R2_adj` | qualité ajustement modèle | `Float?` | 0–1, signal qualité |

## Analyse TYPPRED

Distinction critique pour la qualité des données :
- **`"commune"`** : loyer calculé directement depuis les annonces de cette commune → fiable
- **`"maille"`** : loyer extrapolé depuis une zone géographique plus large → moins précis

Stocker `TYPPRED` en base comme indicateur de confiance (filtrable en affichage).

## Pièges identifiés

- [x] **Encodage Latin-1/Windows-1252** — pas UTF-8 malgré l'extension `.csv`. Utiliser `encoding: 'latin1'` dans `createReadStream`.
- [x] **Décimale `,`** (format français) — `loypredm2`, `lwr.IPm2`, `upr.IPm2`, `R2_adj` : remplacer `,` par `.` avant `parseFloat()`.
- [x] **CRLF** (`\r\n`) — terminateurs Windows, passer `crlfDelay: Infinity` à readline.
- [ ] **TYPPRED = "maille"** — communes sans annonces locales reçoivent un loyer de zone. Stocker `TYPPRED` pour signaler la précision.
- [ ] **Périmètre** : 34 970 communes (hors Mayotte). Communes sans données = absentes du fichier (pas de NULL). Nécessite LEFT JOIN en compute-scores.
- [ ] **Millésime 2023** — annonces SeLoger/leboncoin 2018–2023, publiées 2024-01-15. À renouveler annuellement (URL redirecteur data.gouv.fr stable).

## Mapping schéma Prisma — modèle `LoyerCommune` envisagé

```prisma
model LoyerCommune {
  id              Int     @id @default(autoincrement())
  communeId       Int     @unique
  commune         Commune @relation(fields: [communeId], references: [id])
  loyer_m2        Float?  // loypredm2 (€/m²)
  loyer_m2_ic_low  Float?  // lwr.IPm2
  loyer_m2_ic_high Float?  // upr.IPm2
  typpred         String? // "commune" | "maille"
  nb_obs          Int?    // nbobs_com
  r2_adj          Float?  // qualité modèle 0–1
  annee           Int     // 2023
  @@schema("immo_score")
}
```

## Prochaine étape

Rédiger spec ingestion `DATA-v4-LOY` : script `src/scripts/ingest-loyers.ts` avec :
1. `fetch` URL redirecteur `https://www.data.gouv.fr/api/1/datasets/r/34434cef-2f85-43b9-a601-c625ee426cb7`
2. `createReadStream({ encoding: 'latin1' })`
3. `parseFloat(v.replace(',', '.'))`
4. Upsert sur `commune_id` via lookup `code_insee = INSEE_C`
5. Stocker `TYPPRED` pour diagnostic qualité
