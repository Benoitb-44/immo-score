import {
  FRAIS_NOTAIRE_ANCIEN,
  FRAIS_NOTAIRE_NEUF,
  TAUX_PS,
  ABATTEMENT_MICRO_FONCIER,
  ABATTEMENT_LMNP_MICRO_BIC,
  TAUX_ASSURANCE_EMPRUNTEUR,
  TAUX_VACANCE,
  TAUX_GESTION_LOCATIVE,
  TAUX_ENTRETIEN,
  CHARGES_COPRO_M2_AN,
} from './financial-constants';

export type RegimeFiscal = 'micro_foncier' | 'reel_foncier' | 'lmnp_micro_bic';
export type TypeBien = 'ancien' | 'neuf';

export interface CalcInputs {
  surface: number;
  prix_m2: number;
  loyer_mensuel: number;
  tf_an: number;
  apport_pct: number;
  duree_annees: number;
  taux_nominal_an: number;
  tmi: number;
  regime: RegimeFiscal;
  type_bien: TypeBien;
}

export interface CalcOutputs {
  prix_acquisition: number;
  mensualite_credit: number;
  yield_brut: number;
  yield_net: number;
  cashflow_mensuel: number;
  effort_epargne_mensuel: number;
  impot_an: number;
  loyer_an_brut: number;
  loyer_an_effectif: number;
  charges_tot: number;
  revenu_imposable: number;
}

function validateInputs(inputs: CalcInputs): void {
  if (inputs.surface <= 0) throw new Error('surface must be > 0');
  if (inputs.prix_m2 <= 0) throw new Error('prix_m2 must be > 0');
  if (inputs.loyer_mensuel < 0) throw new Error('loyer_mensuel must be ≥ 0');
  if (inputs.tf_an < 0) throw new Error('tf_an must be ≥ 0');
  if (inputs.apport_pct < 0 || inputs.apport_pct > 1)
    throw new Error('apport_pct must be in [0, 1]');
  if (inputs.duree_annees <= 0) throw new Error('duree_annees must be > 0');
  if (inputs.taux_nominal_an < 0) throw new Error('taux_nominal_an must be ≥ 0');
  if (inputs.tmi < 0 || inputs.tmi > 1) throw new Error('tmi must be in [0, 1]');
}

export function calculateAcquisition(inputs: CalcInputs): {
  prix_acquisition: number;
  frais_notaire: number;
  apport: number;
  capital_emprunte: number;
} {
  validateInputs(inputs);
  const { surface, prix_m2, apport_pct, type_bien } = inputs;
  const prix_acquisition = surface * prix_m2;
  const taux_fn = type_bien === 'neuf' ? FRAIS_NOTAIRE_NEUF : FRAIS_NOTAIRE_ANCIEN;
  const frais_notaire = prix_acquisition * taux_fn;
  // apport_pct s'applique au coût total (prix + frais), convention standard FR
  const cout_total = prix_acquisition + frais_notaire;
  const apport = cout_total * apport_pct;
  const capital_emprunte = Math.max(0, cout_total * (1 - apport_pct));
  return { prix_acquisition, frais_notaire, apport, capital_emprunte };
}

export function calculateCredit(inputs: CalcInputs): {
  mensualite_credit: number;
  total_interets: number;
  interets_moy_an: number;
} {
  validateInputs(inputs);
  const { duree_annees, taux_nominal_an } = inputs;
  const { capital_emprunte } = calculateAcquisition(inputs);

  if (capital_emprunte === 0) {
    return { mensualite_credit: 0, total_interets: 0, interets_moy_an: 0 };
  }

  const n = duree_annees * 12;
  let mensualite_credit: number;

  if (taux_nominal_an === 0) {
    mensualite_credit = capital_emprunte / n;
  } else {
    const tm = taux_nominal_an / 12;
    mensualite_credit = (capital_emprunte * tm) / (1 - Math.pow(1 + tm, -n));
  }

  const total_interets = mensualite_credit * n - capital_emprunte;
  const interets_moy_an = total_interets / duree_annees;

  return { mensualite_credit, total_interets, interets_moy_an };
}

export function calculateRevenuLocatif(inputs: CalcInputs): {
  loyer_an_brut: number;
  loyer_an_effectif: number;
  yield_brut: number;
} {
  validateInputs(inputs);
  const { loyer_mensuel } = inputs;
  const { prix_acquisition } = calculateAcquisition(inputs);

  const loyer_an_brut = loyer_mensuel * 12;
  const loyer_an_effectif = loyer_an_brut * (1 - TAUX_VACANCE);
  const yield_brut = (loyer_an_brut / prix_acquisition) * 100;

  return { loyer_an_brut, loyer_an_effectif, yield_brut };
}

export function calculateCharges(inputs: CalcInputs): {
  charges_tot: number;
  tf: number;
  assurance_emprunteur: number;
  charges_copro: number;
  frais_gestion: number;
  entretien: number;
} {
  validateInputs(inputs);
  const { surface, tf_an } = inputs;
  const { prix_acquisition, capital_emprunte } = calculateAcquisition(inputs);
  const { loyer_an_effectif } = calculateRevenuLocatif(inputs);

  const assurance_emprunteur = capital_emprunte * TAUX_ASSURANCE_EMPRUNTEUR;
  const charges_copro = surface * CHARGES_COPRO_M2_AN;
  const frais_gestion = loyer_an_effectif * TAUX_GESTION_LOCATIVE;
  const entretien = prix_acquisition * TAUX_ENTRETIEN;
  const charges_tot = tf_an + assurance_emprunteur + charges_copro + frais_gestion + entretien;

  return { charges_tot, tf: tf_an, assurance_emprunteur, charges_copro, frais_gestion, entretien };
}

export function calculateFiscalite(inputs: CalcInputs): {
  revenu_imposable: number;
  impot_an: number;
} {
  validateInputs(inputs);
  const { tmi, regime } = inputs;
  const { loyer_an_effectif } = calculateRevenuLocatif(inputs);
  const { charges_tot } = calculateCharges(inputs);
  const { interets_moy_an } = calculateCredit(inputs);

  let revenu_imposable: number;

  switch (regime) {
    case 'micro_foncier':
      revenu_imposable = loyer_an_effectif * (1 - ABATTEMENT_MICRO_FONCIER);
      break;
    case 'lmnp_micro_bic':
      revenu_imposable = loyer_an_effectif * (1 - ABATTEMENT_LMNP_MICRO_BIC);
      break;
    case 'reel_foncier':
      revenu_imposable = loyer_an_effectif - charges_tot - interets_moy_an;
      break;
    /* v8 ignore next 4 */
    default: {
      const _exhaustive: never = regime;
      throw new Error(`Unknown regime: ${_exhaustive}`);
    }
  }

  const impot_an = Math.max(0, revenu_imposable) * (tmi + TAUX_PS);

  return { revenu_imposable, impot_an };
}

export function calculateAll(inputs: CalcInputs): CalcOutputs {
  validateInputs(inputs);

  const { prix_acquisition } = calculateAcquisition(inputs);
  const { mensualite_credit } = calculateCredit(inputs);
  const { loyer_an_brut, loyer_an_effectif, yield_brut } = calculateRevenuLocatif(inputs);
  const { charges_tot } = calculateCharges(inputs);
  const { revenu_imposable, impot_an } = calculateFiscalite(inputs);

  const yield_net = ((loyer_an_effectif - charges_tot - impot_an) / prix_acquisition) * 100;

  const loyer_mensuel_effectif = loyer_an_effectif / 12;
  const charges_mensuelles = charges_tot / 12;
  const impot_mensuel = impot_an / 12;
  const cashflow_mensuel =
    loyer_mensuel_effectif - mensualite_credit - charges_mensuelles - impot_mensuel;
  const effort_epargne_mensuel = Math.max(0, -cashflow_mensuel);

  return {
    prix_acquisition,
    mensualite_credit,
    yield_brut,
    yield_net,
    cashflow_mensuel,
    effort_epargne_mensuel,
    impot_an,
    loyer_an_brut,
    loyer_an_effectif,
    charges_tot,
    revenu_imposable,
  };
}
