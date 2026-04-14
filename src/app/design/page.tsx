import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design System — Precision Brutalism",
  robots: { index: false, follow: false },
};

// ─── Token swatches ────────────────────────────────────────────────────────

const colorTokens = [
  // Ink scale
  { token: "ink",       hex: "#09090b", label: "Ink",       bg: "bg-[#09090b]", text: "text-white" },
  { token: "ink-soft",  hex: "#18181b", label: "Ink Soft",  bg: "bg-[#18181b]", text: "text-white" },
  { token: "ink-muted", hex: "#3f3f46", label: "Ink Muted", bg: "bg-[#3f3f46]", text: "text-white" },
  // Paper scale
  { token: "paper",      hex: "#fafafa", label: "Paper",      bg: "bg-[#fafafa]", text: "text-ink" },
  { token: "paper-soft", hex: "#f4f4f5", label: "Paper Soft", bg: "bg-[#f4f4f5]", text: "text-ink" },
  // Accent
  { token: "accent",       hex: "#2563eb", label: "Accent",       bg: "bg-[#2563eb]", text: "text-white" },
  { token: "accent-hover", hex: "#1d4ed8", label: "Accent Hover", bg: "bg-[#1d4ed8]", text: "text-white" },
  // Scores
  { token: "score-high", hex: "#10b981", label: "Score High (70-100)", bg: "bg-[#10b981]", text: "text-white" },
  { token: "score-mid",  hex: "#f59e0b", label: "Score Mid (40-69)",  bg: "bg-[#f59e0b]", text: "text-white" },
  { token: "score-low",  hex: "#f43f5e", label: "Score Low (0-39)",   bg: "bg-[#f43f5e]", text: "text-white" },
];

const typographyTokens = [
  { label: "Display / H1",   className: "font-display text-4xl font-bold",   sample: "Score Paris 15e : 74/100" },
  { label: "Display / H2",   className: "font-display text-2xl font-semibold", sample: "Prix médian au m²" },
  { label: "Display / H3",   className: "font-display text-xl font-semibold", sample: "Analyse DPE commune" },
  { label: "Body — Large",   className: "font-sans text-lg",                  sample: "Bordeaux obtient un score Immo Score de 82/100, soit le 3e meilleur score de Gironde." },
  { label: "Body — Default", className: "font-sans text-base",                sample: "Le score est calculé à partir de 6 sources open data : DVF, DPE ADEME, BPE INSEE, Géorisques, taxe foncière et démographie INSEE." },
  { label: "Body — Small",   className: "font-sans text-sm text-ink-muted",   sample: "Données mises à jour en janvier 2026. Sources : DVF, ADEME, INSEE." },
  { label: "Mono — Data",    className: "font-mono text-base tabular-nums",   sample: "3 842 €/m² · +4.2% · 2 847 transactions" },
  { label: "Mono — Label",   className: "font-mono text-xs tracking-widest uppercase text-ink-muted", sample: "TAXE FONCIÈRE — 2025" },
];

const spacingTokens = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

const scoreExamples = [
  { score: 84, label: "Annecy",   color: "bg-score-high text-white" },
  { score: 67, label: "Rennes",   color: "bg-score-mid  text-white" },
  { score: 31, label: "Denain",   color: "bg-score-low  text-white" },
];

// ─── Component ────────────────────────────────────────────────────────────

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-paper-soft">
      {/* Header */}
      <header className="border-b-2 border-ink bg-paper px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-baseline justify-between">
          <div>
            <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-1">
              Immo Score — Design System
            </p>
            <h1 className="font-display text-3xl font-bold text-ink">
              Precision Brutalism
            </h1>
          </div>
          <a
            href="/"
            className="font-mono text-sm underline hover:text-accent transition-colors"
          >
            ← Accueil
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12 space-y-16">

        {/* ── Section 1 : Couleurs ── */}
        <section>
          <SectionTitle index="01" title="Couleurs" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {colorTokens.map((c) => (
              <div key={c.token} className="border-2 border-ink overflow-hidden">
                <div className={`${c.bg} h-16`} />
                <div className="bg-paper p-2">
                  <p className={`font-mono text-xs font-bold text-ink`}>{c.label}</p>
                  <p className="font-mono text-xs text-ink-muted">{c.hex}</p>
                  <p className="font-mono text-xs text-ink-muted">{c.token}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 2 : Typographie ── */}
        <section>
          <SectionTitle index="02" title="Typographie" />
          <div className="space-y-0 border-2 border-ink divide-y-2 divide-ink">
            {typographyTokens.map((t) => (
              <div key={t.label} className="bg-paper grid grid-cols-[200px_1fr] gap-0">
                <div className="border-r-2 border-ink bg-paper-soft p-4 flex items-center">
                  <p className="font-mono text-xs text-ink-muted">{t.label}</p>
                </div>
                <div className="p-4 flex items-center overflow-hidden">
                  <p className={`${t.className} truncate`}>{t.sample}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 font-mono text-xs text-ink-muted">
            <span>Headings: Space Grotesk (font-display)</span>
            <span>·</span>
            <span>Body: Inter (font-sans)</span>
            <span>·</span>
            <span>Data: System Mono (font-mono)</span>
          </div>
        </section>

        {/* ── Section 3 : Scores ── */}
        <section>
          <SectionTitle index="03" title="Score Badges" />
          <div className="flex flex-wrap gap-4">
            {scoreExamples.map((s) => (
              <div key={s.label} className="border-2 border-ink">
                <div className={`${s.color} px-6 py-4 text-center`}>
                  <p className="font-display text-5xl font-bold tabular-nums leading-none">
                    {s.score}
                  </p>
                  <p className="font-mono text-xs mt-1 tracking-widest uppercase opacity-80">
                    /100
                  </p>
                </div>
                <div className="bg-paper px-4 py-2 border-t-2 border-ink text-center">
                  <p className="font-display text-sm font-semibold">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-6 font-mono text-xs">
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 bg-score-high border border-ink" />
              70-100 — Attractif
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 bg-score-mid border border-ink" />
              40-69 — Moyen
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 bg-score-low border border-ink" />
              0-39 — Faible
            </span>
          </div>
        </section>

        {/* ── Section 4 : Espacement ── */}
        <section>
          <SectionTitle index="04" title="Espacement (px)" />
          <div className="space-y-2">
            {spacingTokens.map((s) => (
              <div key={s} className="flex items-center gap-4">
                <span className="font-mono text-xs w-8 text-right text-ink-muted">{s}</span>
                <div
                  className="bg-accent border border-ink h-4"
                  style={{ width: `${s * 4}px` }}
                />
                <span className="font-mono text-xs text-ink-muted">{s * 4}px</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 5 : Composants UI ── */}
        <section>
          <SectionTitle index="05" title="Composants UI" />

          <div className="space-y-8">
            {/* Boutons */}
            <div>
              <p className="font-mono text-xs text-ink-muted mb-3 uppercase tracking-widest">Boutons</p>
              <div className="flex flex-wrap gap-3">
                <button className="font-display font-semibold px-5 py-2.5 bg-ink text-paper border-2 border-ink hover:bg-ink-soft transition-colors">
                  Rechercher une commune
                </button>
                <button className="font-display font-semibold px-5 py-2.5 bg-paper text-ink border-2 border-ink hover:bg-paper-soft transition-colors">
                  Comparer
                </button>
                <button className="font-display font-semibold px-5 py-2.5 bg-accent text-white border-2 border-accent hover:bg-accent-hover transition-colors">
                  Voir le score
                </button>
              </div>
            </div>

            {/* Card commune */}
            <div>
              <p className="font-mono text-xs text-ink-muted mb-3 uppercase tracking-widest">Carte commune</p>
              <div className="card-brutal p-0 max-w-xs">
                <div className="flex items-stretch">
                  <div className="bg-score-high text-white flex flex-col items-center justify-center px-5 py-4 min-w-[80px]">
                    <span className="font-display text-3xl font-bold tabular-nums">82</span>
                    <span className="font-mono text-[10px] tracking-widest">/100</span>
                  </div>
                  <div className="border-l-2 border-ink p-4 flex-1">
                    <p className="font-display font-bold text-ink">Bordeaux</p>
                    <p className="font-mono text-xs text-ink-muted">33 — Gironde</p>
                    <p className="font-mono text-sm mt-2 tabular-nums">4 210 €<span className="text-xs">/m²</span></p>
                  </div>
                </div>
              </div>
            </div>

            {/* Data section */}
            <div>
              <p className="font-mono text-xs text-ink-muted mb-3 uppercase tracking-widest">Section données</p>
              <div className="card-brutal max-w-md">
                <div className="border-b-2 border-ink px-5 py-3">
                  <p className="font-display font-semibold text-ink">Prix immobilier DVF</p>
                </div>
                <div className="p-5 grid grid-cols-3 gap-4">
                  {[
                    { label: "Prix médian",    value: "3 842 €", sub: "par m²" },
                    { label: "Transactions",   value: "2 847",   sub: "en 2024" },
                    { label: "Tendance",       value: "+4.2 %",  sub: "vs 2023" },
                  ].map((d) => (
                    <div key={d.label} className="text-center">
                      <p className="font-mono text-xl font-bold tabular-nums text-ink">{d.value}</p>
                      <p className="font-mono text-[10px] text-ink-muted mt-1">{d.sub}</p>
                      <p className="font-mono text-[10px] text-ink-muted">{d.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Alert / badge source */}
            <div>
              <p className="font-mono text-xs text-ink-muted mb-3 uppercase tracking-widest">Source badge</p>
              <div className="inline-flex items-center gap-2 border-2 border-ink bg-paper px-3 py-1.5">
                <span className="font-mono text-xs font-bold">SOURCE</span>
                <span className="w-px h-4 bg-ink" />
                <span className="font-mono text-xs text-ink-muted">Demandes de Valeurs Foncières (DVF) — data.gouv.fr</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 6 : Principes ── */}
        <section>
          <SectionTitle index="06" title="Principes Precision Brutalism" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { rule: "Bordures 2px", desc: "Contours nets, pas d'ombre portée. border-2 border-ink partout." },
              { rule: "Typographie contrastée", desc: "font-display pour les chiffres, font-mono pour les données. Jamais de texte < 10px." },
              { rule: "Données d'abord", desc: "Les chiffres sont grands, en gras, en tabular-nums. L'ornement vient après." },
              { rule: "Zéro coins arrondis", desc: "Pas de rounded-* sauf exception explicite. Angles droits = précision." },
              { rule: "Grille stricte", desc: "Grid CSS ou Flexbox aligné. Pas de positionnement absolu pour le layout." },
              { rule: "Couleur fonctionnelle", desc: "La couleur encode l'information (score, état). Jamais décorative." },
            ].map((p) => (
              <div key={p.rule} className="card-brutal p-4">
                <p className="font-display font-semibold text-ink mb-1">{p.rule}</p>
                <p className="font-sans text-sm text-ink-muted">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t-2 border-ink bg-paper mt-16 px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <p className="font-mono text-xs text-ink-muted">
            Immo Score — Design System v0.1 — INFRA-06
          </p>
          <p className="font-mono text-xs text-ink-muted">
            Fonts : Space Grotesk + Inter via next/font
          </p>
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-6">
      <span className="font-mono text-xs text-ink-muted">{index}</span>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <div className="flex-1 h-px bg-ink" />
    </div>
  );
}
