# Commande /audit-seo

Audite le SEO d'une page commune : meta tags, structured data, internal linking.

## Usage
```
/audit-seo [slug]
```
Exemple : `/audit-seo bordeaux`

## Comportement
1. Récupérer les données de la commune via Prisma (slug → commune + scores)
2. Simuler le rendu des meta tags que `generateMetadata` produirait :
   - `<title>` : vérifie la présence du nom, département, score, prix, "Immo Score"
   - `<meta description>` : vérifie la longueur (120-160 chars), la présence du score
   - `og:image`, `og:url`, `canonical` : vérifie la présence
3. Valider le JSON-LD :
   - Type `Place` présent
   - `PropertyValue` pour le score présent
   - Coordonnées GPS présentes
4. Vérifier l'internal linking :
   - Lien vers la page département présent
   - Au moins 5 liens vers des communes voisines
5. Afficher un rapport avec les points à corriger

## Rapport type
```
Audit SEO — [Commune] ([slug])
✅ Title : OK (62 chars)
✅ Meta description : OK (148 chars)
⚠️  og:image : manquant (pas critique pour le SEO mais recommandé)
✅ JSON-LD Place : OK
❌ JSON-LD PropertyValue score : manquant
✅ Canonical : OK
⚠️  Internal linking communes voisines : 3 liens (minimum recommandé : 5)
```
