# Commande /ingest-data

Lance un script d'ingestion de données pour une source spécifique.

## Usage
```
/ingest-data [source]
```
Sources : `communes`, `dvf`, `dpe`, `bpe`, `risques`, `fiscalite`, `demo`, `all`

## Comportement
1. Exécuter le script `src/scripts/ingest-[source].ts`
2. Afficher le résultat (communes traitées, erreurs, durée)
3. Si `all` : exécuter tous les scripts dans l'ordre, puis `compute-scores`
4. Proposer de lancer la revalidation ISR si des données ont changé
