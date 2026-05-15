.PHONY: help \
        ingest-aav ingest-filosofi ingest-cerema \
        aggregate-dvf-prix-tx \
        compute-scores compute-accessibilite \
        shell db logs restart \
        probe-xlsx

APP  := cityrank
DB   := cityrank-db
PSQL := docker exec -it $(DB) psql -U immo_score -d postgres

# ── Affichage de l'aide ────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "CityRank — commandes ops"
	@echo ""
	@echo "  Ingestion"
	@echo "    make ingest-aav              Mapping AAV (Aire d'Attraction des Villes)"
	@echo "    make ingest-filosofi         Revenus/pauvreté (INSEE Filosofi)"
	@echo "    make ingest-cerema           Accessibilité aux services (Cerema)"
	@echo ""
	@echo "  Agrégation"
	@echo "    make aggregate-dvf-prix-tx   Agrégation DVF prix & taux par commune"
	@echo ""
	@echo "  Calcul"
	@echo "    make compute-scores          Score composite 0-100 (toutes communes)"
	@echo "    make compute-accessibilite   Score accessibilité financière"
	@echo ""
	@echo "  Infra"
	@echo "    make shell                   Shell dans le container app"
	@echo "    make db                      psql dans le container DB"
	@echo "    make logs                    Logs temps réel du container app"
	@echo "    make restart                 Redémarre le container app"
	@echo ""
	@echo "  Outillage"
	@echo "    make probe-xlsx FILE=<path>  Inspecte un fichier XLSX (TODO: TECH-DEBT-01)"
	@echo ""

# ── Ingestion ──────────────────────────────────────────────────────────────────
ingest-aav:
	docker exec -it $(APP) npm run ingest:aav

ingest-filosofi:
	docker exec -it $(APP) npm run ingest:filosofi

ingest-cerema:
	docker exec -it $(APP) npm run ingest:cerema

# ── Agrégation ─────────────────────────────────────────────────────────────────
aggregate-dvf-prix-tx:
	docker exec -it $(APP) npm run aggregate:dvf-prix-tx

# ── Calcul ─────────────────────────────────────────────────────────────────────
compute-scores:
	docker exec -it $(APP) npm run compute:scores

compute-accessibilite:
	docker exec -it $(APP) npm run compute:accessibilite

# ── Infra ──────────────────────────────────────────────────────────────────────
shell:
	docker exec -it $(APP) sh

db:
	$(PSQL)

logs:
	docker logs -f $(APP)

restart:
	docker compose restart $(APP)

# ── Outillage ──────────────────────────────────────────────────────────────────
probe-xlsx:
	@echo "TODO: cf TECH-DEBT-01 — script probe-xlsx à implémenter (mesure 1)"
