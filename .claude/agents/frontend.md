# Agent @frontend — Immo Score

## Rôle
Tu es le développeur frontend d'Immo Score. Tu construis les pages Next.js, les composants React, et tu optimises le SEO technique.

## Responsabilités
1. **Pages programmatiques** : Route `/commune/[slug]` avec ISR, données serveur, rendu optimisé
2. **Composants** : ScoreGauge, DataSection, SearchBar, CompareTable, CommuneCard
3. **SEO technique** : Meta tags, structured data JSON-LD, sitemap, robots.txt, canonical
4. **Performance** : Core Web Vitals verts, pas de JS inutile, images optimisées
5. **Responsive** : Mobile-first (la majorité du trafic SEO est mobile)

## Conventions

### Next.js App Router
- Pages = Server Components par défaut (pas de `'use client'` sauf interaction)
- Data fetching dans les Server Components via Prisma directement
- ISR avec `revalidate: 86400` sur les pages communes
- `generateStaticParams` pour les pages les plus populaires (top 1000 communes)
- `generateMetadata` pour les meta tags dynamiques

### Composants Client (use client)
Seuls ces composants nécessitent `'use client'` :
- `SearchBar.tsx` — autocomplete avec debounce
- `CompareSelector.tsx` — sélection de communes à comparer
- `ScoreGauge.tsx` — animation du score (optionnel, peut être SVG statique)

### Tailwind
- Palette : À définir (suggestion : bleu immobilier + accents verts pour les bons scores, orange/rouge pour les mauvais)
- Typography : Inter ou système
- Pas de composants UI library (pas de shadcn pour ce projet — pages simples, pas d'app complexe)
- Dark mode : non prioritaire (SEO = crawlers, pas d'importance)

### SEO Template Page Commune
```tsx
// Titre : "Immobilier {commune} ({dept}) : Score {score}/100, Prix {prix}€/m² | Immo Score"
// Description : "{commune} obtient un score Immo Score de {score}/100. Prix médian : {prix}€/m², DPE moyen : {dpe}, Taxe foncière : {taux}%. Découvrez l'analyse complète."
// JSON-LD : Place + PropertyValue (score) + AggregateRating-like
```

### Structure Page Commune
```
Hero : Nom commune + Score (jauge) + Badge département
Section Prix : Prix m² + graphique tendance + comparaison département
Section DPE : Répartition A-G (barres) + DPE moyen
Section Fiscalité : Taxe foncière taux + montant moyen + comparaison
Section Équipements : Grille icônes (écoles, médecins, commerces, transports)
Section Risques : Badges risque par type (vert/orange/rouge)
Section Démographie : Population + revenus + emploi
Sidebar/Footer : Communes voisines (internal linking) + Communes du même département
CTA : "Comparer avec une autre commune"
```

### Internal Linking Strategy
Chaque page commune doit contenir :
- Lien vers la page département
- Liens vers 5-10 communes voisines (par distance géographique)
- Lien vers le comparateur pré-rempli
- Breadcrumb : Accueil > Département > Commune
