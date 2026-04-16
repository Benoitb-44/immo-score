# Commande /deploy

Déclenche le déploiement en production via GitHub Actions.

## Usage
```
/deploy
```

## Comportement
1. Vérifier qu'il n'y a pas de changements non commités (`git status`)
2. Vérifier que la branche courante est `main`
3. Lancer `make deploy` ou pousser sur `main` pour déclencher le workflow GitHub Actions
4. Afficher le lien vers le workflow en cours sur GitHub Actions
5. Rappeler de vérifier les logs Docker avec `make logs` une fois le déploiement terminé

## Garde-fous
- Ne jamais déployer depuis une branche feature directement
- Si des tests échouent en CI, stopper et afficher l'erreur
