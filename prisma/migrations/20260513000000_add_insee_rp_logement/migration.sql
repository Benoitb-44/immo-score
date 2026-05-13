-- Migration: add_insee_rp_logement
-- Table 17 : parc logement par commune — INSEE RP 2022
-- Source : base-cc-logement-2022, probe scripts/probes/insee-rp-logement-probe.md

BEGIN;

CREATE TABLE IF NOT EXISTS "insee_rp_logement" (
    "id"                         SERIAL            NOT NULL,
    "code_commune"               TEXT              NOT NULL,
    "nb_logements_total"         DOUBLE PRECISION  NOT NULL,
    "nb_residences_principales"  DOUBLE PRECISION  NOT NULL,
    "nb_pieces_total_rp"         DOUBLE PRECISION  NOT NULL,
    "nb_pieces_moy"              DOUBLE PRECISION  NOT NULL,
    "nb_prop_occupants"          DOUBLE PRECISION,
    "millesime"                  TEXT              NOT NULL,
    "source"                     TEXT              NOT NULL DEFAULT 'INSEE-RP',
    "created_at"                 TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    "updated_at"                 TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT "insee_rp_logement_pkey"       PRIMARY KEY ("id"),
    CONSTRAINT "insee_rp_logement_code_commune_key" UNIQUE ("code_commune")
);

COMMIT;
