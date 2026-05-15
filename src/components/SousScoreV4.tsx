/**
 * SousScoreV4 — Composant générique pour les sous-scores v4 (Sprint 4-A+)
 *
 * Réutilisable pour les 4 dimensions v4 :
 *   accessibilité financière · DPE v4 · équipements v4 · risques v4
 *
 * Props :
 *   titre       Label de la dimension (ex: "Accessibilité financière")
 *   valeur      Score 0-100 ou null si non calculé
 *   niveau      Niveau de fallback N1/N2/N3/N4 (N1 = données directes)
 *   source      Texte court de la source (ex: "Cerema DV3F 2022-2024")
 *   lienMethodo URL de l'ancre méthodologie (ex: "/methodologie#v4-accessibilite")
 */

export type NiveauFallback = 'N1' | 'N2' | 'N3' | 'N4';

interface SousScoreV4Props {
  titre: string;
  valeur: number | null;
  niveau: NiveauFallback | null;
  source: string;
  lienMethodo: string;
}

const NIVEAU_CONFIG: Record<NiveauFallback, { label: string; desc: string; badgeClass: string }> = {
  N1: {
    label: 'N1 — Données directes',
    desc: 'Données communales directes Cerema DV3F 2022-2024.',
    badgeClass: 'bg-score-high text-white',
  },
  N2: {
    label: 'N2 — DVF + Filosofi',
    desc: 'Prix DVF croisé avec revenus Filosofi INSEE 2021. Précision correcte.',
    badgeClass: 'bg-score-mid text-white',
  },
  N3: {
    label: 'N3 — Médiane dép.',
    desc: 'Médiane départementale faute de données communales. Indicatif.',
    badgeClass: 'bg-orange-500 text-white',
  },
  N4: {
    label: 'N4 — Médiane nationale',
    desc: 'Fallback ultime — médiane nationale. Peu représentatif localement.',
    badgeClass: 'bg-score-low text-white',
  },
};

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 70) return { bg: 'bg-score-high', text: 'text-white' };
  if (score >= 40) return { bg: 'bg-score-mid', text: 'text-white' };
  return { bg: 'bg-score-low', text: 'text-white' };
}

export default function SousScoreV4({
  titre,
  valeur,
  niveau,
  source,
  lienMethodo,
}: SousScoreV4Props) {
  const rounded = valeur != null ? Math.round(valeur) : null;
  const color = rounded != null ? scoreColor(rounded) : null;
  const niveauCfg = niveau ? NIVEAU_CONFIG[niveau] : null;
  const isImputed = niveau !== null && niveau !== 'N1';

  return (
    <div className="border-2 border-ink bg-paper">
      {/* Header */}
      <div className="border-b-2 border-ink px-6 py-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-display font-semibold text-ink">{titre}</p>
          <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mt-0.5">
            Source : {source}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {niveauCfg && (
            <span
              className={`font-mono text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 ${niveauCfg.badgeClass}`}
            >
              {niveau}
            </span>
          )}
          <a
            href={lienMethodo}
            className="font-mono text-[10px] tracking-widest uppercase text-ink-muted border border-ink-muted px-2 py-0.5 hover:bg-ink hover:text-paper transition-colors"
          >
            Méthodo
          </a>
        </div>
      </div>

      {/* Body */}
      {rounded == null ? (
        <div className="px-6 py-8 flex items-center justify-center">
          <p className="font-mono text-sm text-ink-muted">Données insuffisantes</p>
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {color && (
            <div
              className={`${color.bg} ${color.text} border-2 border-ink px-8 py-5 flex items-baseline gap-2 shrink-0`}
            >
              <span className="font-display text-6xl font-bold tabular-nums leading-none">
                {rounded}
              </span>
              <span className="font-mono text-base">/100</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {isImputed && niveauCfg && (
              <p className="font-mono text-[10px] text-ink-muted border border-ink-muted px-2 py-1 inline-block self-start leading-relaxed">
                <span className="font-bold text-ink mr-1">{niveau}</span>
                {niveauCfg.desc}
              </p>
            )}
            {!isImputed && (
              <p className="font-mono text-[10px] text-score-high border border-score-high px-2 py-1 inline-block self-start">
                Données directes — meilleure précision disponible
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
