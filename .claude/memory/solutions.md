# Solutions — Patterns validés CityRank

> Solutions éprouvées en production. À réutiliser tel quel.

## Score composite v3.1

```
score = géométrique(dvf, dpe, bpe, risques, fiscalite, démographie)
pondérations : DVF 45% | BPE 20% | DPE 10% | Risques 25%
chaque composante : floor=10, cap=100, normalisation percentile rank
```

## Upsert idempotent (pattern universel)

```typescript
await prisma.model.upsert({
  where: { code_commune_annee: { code_commune, annee } },
  update: { ...data, updated_at: new Date() },
  create: { code_commune, annee, ...data },
});
```

## Sitemap dynamique

```typescript
// src/app/sitemap.ts
export const dynamic = 'force-dynamic'; // ligne 1 obligatoire
export const revalidate = 0;
```

## DPE backoff 429

```typescript
if (res.status === 429) {
  await new Promise(r => setTimeout(r, 2000 * attempt));
  continue;
}
```

## Imputation DVF régionale

1. Calculer médianes régionales via SQL sur `dvf_prix` agrégé
2. Si commune sans DVF ou `nbTx < seuil` → utiliser médiane région
3. Setter `dvf_imputed=true`, `dvf_imputed_method='regional_median'`

## Workflow ingestion (depuis le VPS)

```bash
# 1. Push fix sur main (CI auto-deploy ~3 min)

# 2. SSH VPS + ingestion
ssh ubuntu@37.59.122.208
docker exec -it cityrank npm run ingest:dpe
docker exec -it cityrank npm run compute:scores

# 3. Validation SQL témoin
docker exec -it cityrank npx prisma db execute --stdin <<EOF
SELECT c.slug, s.score_global, s.score_dvf, s.score_dpe, s.score_risques
FROM immo_score.communes c
JOIN immo_score.scores s ON c.id = s.commune_id
WHERE c.slug IN ('bordeaux','paris','lyon','rennes','nantes','ambleon')
ORDER BY s.score_global DESC;
EOF
```

## Critères de validation post-recalcul

- Bordeaux `score_dpe` > 50 ✅ (était 9/100 en v1)
- Paris `score_global` > 20 ✅ (était ~0 en v1)
- Ambléon `score_global` ≠ Bordeaux (comportement attendu)
- Logny-lès-Aubenton (sans DPE) : score sur DVF+Risques uniquement, `score_dpe` NULL en base
- 0 commune avec `score_global` = NaN ou Infinity
- Log couverture Géorisques affiché en fin de batch

## Rate limiting ingestion

```typescript
async function rateLimitedFetch(url: string, rps: number = 10): Promise<Response> {
  await new Promise(resolve => setTimeout(resolve, 1000 / rps));
  const response = await fetch(url);
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return rateLimitedFetch(url, rps / 2); // Backoff
  }
  return response;
}
```

## Structure de retour script d'ingestion

```typescript
interface IngestResult {
  source: string;
  communes_processed: number;
  communes_updated: number;
  communes_errored: number;
  duration_ms: number;
  errors: string[]; // top 20
}
```

## SEO : meta tags page commune

Voir `docs/seo-programmatic.md` pour les helpers `generateCommuneMetadata` et `generateCommuneJsonLd`.
