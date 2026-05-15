-- Migration: add_taxe_fonciere_commune
-- DATA-v4-TF — Table taxe_fonciere_communes (OFGL REI 2024, cumul commune+EPCI)
--
-- Pour exécution manuelle via psql sur le VPS :
--   docker exec cityrank-db psql -U $POSTGRES_USER -d $POSTGRES_DB \
--     -f ~/cityrank/prisma/migrations/20260512000000_add_taxe_fonciere_commune/migration.sql
-- Puis marquer comme appliquée :
--   docker compose exec -T cityrank npx prisma migrate resolve \
--     --applied 20260512000000_add_taxe_fonciere_commune

SET search_path TO immo_score;

BEGIN;

CREATE TABLE IF NOT EXISTS "taxe_fonciere_communes" (
    "id"                   TEXT             NOT NULL,
    "code_commune"         TEXT             NOT NULL,
    "montant_tfb_communal" DOUBLE PRECISION,
    "montant_tfb_epci"     DOUBLE PRECISION,
    "montant_tfb_total"    DOUBLE PRECISION,
    "base_nette"           DOUBLE PRECISION,
    "taux_communal_pct"    DOUBLE PRECISION,
    "taux_epci_pct"        DOUBLE PRECISION,
    "millesime"            INTEGER          NOT NULL DEFAULT 2024,
    "source"               TEXT             NOT NULL DEFAULT 'ofgl-rei',
    "secret_statistique"   BOOLEAN          NOT NULL DEFAULT false,
    "sec_stat_reason"      TEXT,
    "created_at"           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    "updated_at"           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT "taxe_fonciere_communes_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "taxe_fonciere_communes_code_commune_key"
        UNIQUE ("code_commune"),
    CONSTRAINT "taxe_fonciere_communes_code_commune_fkey"
        FOREIGN KEY ("code_commune")
        REFERENCES "communes"("code_insee")
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS "taxe_fonciere_communes_taux_communal_idx"
    ON "taxe_fonciere_communes"("taux_communal_pct");

COMMIT;
