# Commande /status

Vérifie la fraîcheur des données dans la base PostgreSQL et l'état général du pipeline.

## Usage
```
/status
```

## Comportement
1. Requêter la date du dernier `updated_at` pour chaque table de données :
   - `immo_score.communes`
   - `immo_score.dvf_prix`
   - `immo_score.dpe_communes`
   - `immo_score.equipements`
   - `immo_score.risques`
   - `immo_score.fiscalite`
   - `immo_score.demographie`
   - `immo_score.scores`
2. Afficher un tableau récapitulatif :
   - Source | Dernière MAJ | Nb communes renseignées | Statut (Frais / À rafraîchir)
3. Flaguer les sources avec `updated_at` > 35 jours comme "À rafraîchir"
4. Afficher le score moyen national et le nb de communes avec un score

## Seuils d'alerte
- > 35 jours sans MAJ → orange
- > 90 jours sans MAJ → rouge (données potentiellement obsolètes affichées sur les pages)
