-- Migration: add source tracking columns to loyer_communes
-- DATA-v4-LOY-3M Phase 2 Step 1 (R2 — hiérarchie N1/N1bis/N2/N3/N4)
--
-- Pour exécution manuelle via psql sur le VPS :
--   docker exec cityrank-db psql -U immo_score_admin -d immo_score \
--     -f ~/cityrank/prisma/migrations/20260503000000_add_loyer_source_tracking/migration.sql
-- Puis marquer comme appliquée :
--   docker compose exec -T cityrank npx prisma migrate resolve \
--     --applied 20260503000000_add_loyer_source_tracking
-- OU via Prisma (une fois le schéma migrations initialisé avec baseline) :
--   prisma migrate deploy

-- Assurer le bon search_path (idempotent si exécuté par Prisma)
SET search_path TO immo_score;

BEGIN;

-- Step 1 : ajouter les colonnes en NULLABLE (obligatoire avant backfill)
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "niveau"      TEXT;
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "source"      TEXT;
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "millesime"   INTEGER;
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "nb_obs_src"  INTEGER;
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "q1_m2"       DECIMAL(6,2);
ALTER TABLE "loyer_communes" ADD COLUMN IF NOT EXISTS "q3_m2"       DECIMAL(6,2);

-- Step 2 : backfill — toutes les lignes existantes sont Carte Loyers ANIL 2023 = N1
UPDATE "loyer_communes"
SET
  "niveau"    = 'N1',
  "source"    = 'carte_loyers_anil',
  "millesime" = 2023
WHERE "niveau" IS NULL;

-- Step 3 : passer NOT NULL après backfill
ALTER TABLE "loyer_communes" ALTER COLUMN "niveau"    SET NOT NULL;
ALTER TABLE "loyer_communes" ALTER COLUMN "source"    SET NOT NULL;
ALTER TABLE "loyer_communes" ALTER COLUMN "millesime" SET NOT NULL;

-- Step 4 : index composite pour les requêtes par niveau/source
CREATE INDEX IF NOT EXISTS "loyer_communes_niveau_source_idx"
  ON "loyer_communes"("niveau", "source");

COMMIT;
