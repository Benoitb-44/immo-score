# Commande /compute-scores

Recalcule le score composite pour toutes les communes.

## Usage
```
/compute-scores
```

## Comportement
1. Exécuter `src/scripts/compute-scores.ts`
2. Afficher les statistiques : distribution des scores, top 10, bottom 10
3. Comparer avec le calcul précédent (nb communes dont le score a changé de > 5 points)
4. Proposer de revalider les pages impactées via `/api/revalidate`
