/**
 * bpe-codes.ts
 * 30 codes FACILITY_TYPE retenus de la BPE INSEE 2024 pour le scoring équipements.
 * Distribués en 5 sous-catégories : education, sante, commerces, transport, cultureSport.
 *
 * Codes entièrement renumérotés vs BPE 2023 (format harmonisé européen, millésime 2024).
 * Table de passage officielle : insee.fr/fr/metadonnees/source/fichier/BPE24_table_passage.csv
 *
 * ATTENTION : has_autoroute (ancien E107 2023) n'a pas d'équivalent en BPE 2024.
 * Le flag est conservé pour ne pas casser le schéma BDD, mais sera toujours false.
 */

export type BpeCategory = 'education' | 'sante' | 'commerces' | 'transport' | 'cultureSport';

export interface BpeCode {
  typequ: string;  // Code FACILITY_TYPE dans BPE 2024 ('' = pas d'équivalent 2024)
  label: string;
  category: BpeCategory;
  /** Nom du champ booléen dans BpeCommune (has_xxx) */
  flag: string;
}

export const BPE_CODES: readonly BpeCode[] = [
  // ── Éducation (5) ────────────────────────────────────────────────────────
  { typequ: 'D502', label: 'Crèche / accueil jeune enfant',      category: 'education',    flag: 'has_creche' },
  { typequ: 'C107', label: 'École maternelle',                    category: 'education',    flag: 'has_ecole_maternelle' },
  { typequ: 'C109', label: 'École élémentaire',                   category: 'education',    flag: 'has_ecole_primaire' },
  { typequ: 'C201', label: 'Collège',                             category: 'education',    flag: 'has_college' },
  { typequ: 'C301', label: 'Lycée',                               category: 'education',    flag: 'has_lycee' },

  // ── Santé (7) ─────────────────────────────────────────────────────────────
  { typequ: 'D265', label: 'Médecin généraliste',                 category: 'sante',        flag: 'has_medecin' },
  { typequ: 'D277', label: 'Chirurgien-dentiste',                 category: 'sante',        flag: 'has_dentiste' },
  { typequ: 'D307', label: 'Pharmacie',                           category: 'sante',        flag: 'has_pharmacie' },
  { typequ: 'D106', label: 'Urgences',                            category: 'sante',        flag: 'has_urgences' },
  { typequ: 'D107', label: 'Maternité',                           category: 'sante',        flag: 'has_maternite' },
  { typequ: 'D101', label: 'Hôpital court séjour',                category: 'sante',        flag: 'has_hopital' },
  { typequ: 'D401', label: 'EHPAD / hébergement pers. âgées',     category: 'sante',        flag: 'has_ehpad' },

  // ── Commerces & services (7) ──────────────────────────────────────────────
  { typequ: 'B104', label: 'Hypermarché / grand magasin',         category: 'commerces',    flag: 'has_hypermarche' },
  { typequ: 'B201', label: 'Supérette',                           category: 'commerces',    flag: 'has_superette' },
  { typequ: 'B207', label: 'Boulangerie-pâtisserie',              category: 'commerces',    flag: 'has_boulangerie' },
  { typequ: 'B324', label: 'Librairie',                           category: 'commerces',    flag: 'has_librairie' },
  { typequ: 'A203', label: 'Banque / caisse d\'épargne',          category: 'commerces',    flag: 'has_banque' },
  { typequ: 'A206', label: 'Bureau de poste',                     category: 'commerces',    flag: 'has_poste' },
  { typequ: 'A101', label: 'Police / gendarmerie',                category: 'commerces',    flag: 'has_police' },

  // ── Transport (5) ─────────────────────────────────────────────────────────
  { typequ: 'E107', label: 'Gare nationale',                      category: 'transport',    flag: 'has_gare_national' },
  { typequ: 'E108', label: 'Gare régionale',                      category: 'transport',    flag: 'has_gare_regional' },
  { typequ: 'E109', label: 'Gare locale / arrêt interurbain',     category: 'transport',    flag: 'has_arret_transport' },
  { typequ: '',     label: 'Accès autoroute (supprimé BPE 2024)', category: 'transport',    flag: 'has_autoroute' },
  { typequ: 'E102', label: 'Aéroport',                            category: 'transport',    flag: 'has_aeroport' },

  // ── Culture & sport (6) ───────────────────────────────────────────────────
  { typequ: 'F303', label: 'Cinéma',                              category: 'cultureSport', flag: 'has_cinema' },
  { typequ: 'F315', label: 'Arts du spectacle / salle de spectacle', category: 'cultureSport', flag: 'has_salle_spectacle' },
  { typequ: 'F101', label: 'Bassin de natation / piscine',        category: 'cultureSport', flag: 'has_piscine' },
  { typequ: 'F113', label: 'Terrains de grands jeux (stade)',     category: 'cultureSport', flag: 'has_stade' },
  { typequ: 'F121', label: 'Gymnase / salle multisports',         category: 'cultureSport', flag: 'has_gymnase' },
  { typequ: 'F103', label: 'Tennis (court)',                      category: 'cultureSport', flag: 'has_tennis' },
];

/** Lookup rapide FACILITY_TYPE → BpeCode */
export const BPE_CODE_MAP = new Map(BPE_CODES.filter(c => c.typequ).map(c => [c.typequ, c]));

/** Set des FACILITY_TYPE retenus pour le filtrage CSV (exclut les codes vides = dépréciés) */
export const BPE_TYPEQUS = new Set(BPE_CODES.map(c => c.typequ).filter(Boolean));

/** Nombre total d'équipements essentiels (dénominateur du score) */
export const BPE_TOTAL = BPE_CODES.length; // 30
