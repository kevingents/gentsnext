/**
 * De opmaak van het handboek — één stylesheet voor twee afnemers: de pagina
 * /handboek (die de portal opent) en de losse HTML-uitdraai. Anders zou de
 * uitdraai er langzaam anders uit gaan zien dan het scherm.
 *
 * Bewust platte CSS in plaats van Tailwind-klassen: de hoofdstukinhoud staat als
 * HTML in content/handboek.ts, en die kan geen utility-klassen kennen zonder dat
 * elke tekstwijziging een opmaakwijziging wordt.
 *
 * Drie thema-standen, precies zoals de rest van de site: de kale :root is licht,
 * de systeemvoorkeur schakelt naar donker tenzij iemand expliciet licht koos, en
 * een expliciete keuze wint altijd.
 */
export const HANDBOEK_CSS = `
:root {
  --hb-ground: #EEF2F8; --hb-surface: #FFFFFF; --hb-surface-2: #F6F8FC;
  --hb-ink: #16243F; --hb-ink-deep: #16243F; --hb-ink-2: #3B4C6B; --hb-ink-3: #6B7A93;
  --hb-line: #D6DEEA; --hb-line-soft: #E6ECF4;
  --hb-accent: #9C7A42; --hb-accent-bright: #B7935A; --hb-accent-wash: #F5EEE1;
  --hb-good: #2C7F60; --hb-good-wash: #E3F1EB;
  --hb-warn: #9C6714; --hb-warn-wash: #FAF0DC;
  --hb-bad: #A63F37; --hb-bad-wash: #FAE6E5;
  --hb-cool: #2C5A83; --hb-cool-wash: #E4EDF6;
  --hb-shadow: 0 1px 2px rgba(22,36,63,.06), 0 8px 24px -16px rgba(22,36,63,.28);
  --hb-serif: Newsreader, Georgia, "Times New Roman", serif;
  --hb-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --hb-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --hb-ground: #0C1421; --hb-surface: #141F33; --hb-surface-2: #18263D;
    --hb-ink: #E8EDF6; --hb-ink-deep: #080F1B; --hb-ink-2: #B4C1D6; --hb-ink-3: #8595AF;
    --hb-line: #2A3A57; --hb-line-soft: #223149;
    --hb-accent: #CBA76C; --hb-accent-bright: #D9B87F; --hb-accent-wash: #2A2418;
    --hb-good: #6FC3A0; --hb-good-wash: #14291F;
    --hb-warn: #D9A54F; --hb-warn-wash: #2A2214;
    --hb-bad: #E0857C; --hb-bad-wash: #2C1917;
    --hb-cool: #79ADDD; --hb-cool-wash: #14243A;
    --hb-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px -18px rgba(0,0,0,.8);
  }
}
:root[data-theme="dark"] {
  --hb-ground: #0C1421; --hb-surface: #141F33; --hb-surface-2: #18263D;
  --hb-ink: #E8EDF6; --hb-ink-deep: #080F1B; --hb-ink-2: #B4C1D6; --hb-ink-3: #8595AF;
  --hb-line: #2A3A57; --hb-line-soft: #223149;
  --hb-accent: #CBA76C; --hb-accent-bright: #D9B87F; --hb-accent-wash: #2A2418;
  --hb-good: #6FC3A0; --hb-good-wash: #14291F;
  --hb-warn: #D9A54F; --hb-warn-wash: #2A2214;
  --hb-bad: #E0857C; --hb-bad-wash: #2C1917;
  --hb-cool: #79ADDD; --hb-cool-wash: #14243A;
  --hb-shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px -18px rgba(0,0,0,.8);
}

.hb, .hb * { box-sizing: border-box; }
.hb { background: var(--hb-ground); color: var(--hb-ink); font-family: var(--hb-sans); font-size: 16px; line-height: 1.6; min-height: 100vh; }
.hb h1, .hb h2, .hb h3, .hb h4 { font-family: var(--hb-serif); font-weight: 600; margin: 0; text-wrap: balance; }
.hb p { margin: 0; max-width: 74ch; }
.hb a { color: inherit; }
.hb a:focus-visible, .hb button:focus-visible, .hb input:focus-visible { outline: 2px solid var(--hb-accent-bright); outline-offset: 3px; border-radius: 4px; }

.hb-mast { background: var(--hb-ink-deep); color: #F2F5FA; padding: 2.6rem 1.5rem 2.2rem; border-bottom: 3px solid var(--hb-accent-bright); }
.hb-mast-in { max-width: 1240px; margin: 0 auto; display: flex; flex-direction: column; gap: .8rem; }
.hb-merk { font-family: var(--hb-mono); font-size: .76rem; letter-spacing: .3em; color: var(--hb-accent-bright); }
.hb-mast h1 { font-size: clamp(2rem, 4.6vw, 3rem); line-height: 1.08; color: #FFF; }
.hb-mast .hb-lead { color: #C6D2E4; font-size: clamp(.98rem, 1.5vw, 1.1rem); max-width: 68ch; }
.hb-eyebrow { font-family: var(--hb-mono); font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--hb-accent); margin: 0; }
.hb-meta-rij { display: flex; flex-wrap: wrap; gap: .45rem; }
.hb-meta { font-family: var(--hb-mono); font-size: .72rem; border: 1px solid rgba(183,147,90,.45); color: #E4D9C4; padding: .26rem .6rem; border-radius: 999px; }

.hb-shell { max-width: 1240px; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; display: grid; grid-template-columns: 1fr; gap: 1.8rem; }
@media (min-width: 1080px) { .hb-shell { grid-template-columns: 262px 1fr; gap: 2.4rem; align-items: start; } }

.hb-rail { position: sticky; top: 1rem; align-self: start; display: flex; flex-direction: column; gap: .7rem; max-height: calc(100vh - 2rem); }
.hb-zoek { position: relative; }
.hb-zoek input { width: 100%; font: inherit; font-size: .9rem; padding: .55rem .75rem .55rem 2.1rem; border: 1px solid var(--hb-line); border-radius: 8px; background: var(--hb-surface); color: var(--hb-ink); }
.hb-zoek svg { position: absolute; left: .6rem; top: 50%; transform: translateY(-50%); width: 1rem; height: 1rem; color: var(--hb-ink-3); }
.hb-uitslag { font-family: var(--hb-mono); font-size: .72rem; color: var(--hb-ink-3); min-height: 1.1em; }
.hb-toc { overflow-y: auto; padding-right: .3rem; }
.hb-toc .hb-deelkop { font-family: var(--hb-mono); font-size: .67rem; letter-spacing: .12em; text-transform: uppercase; color: var(--hb-ink-3); margin: .85rem 0 .2rem; }
.hb-toc .hb-deelkop:first-child { margin-top: 0; }
.hb-toc a { display: grid; grid-template-columns: 2.5rem 1fr; align-items: baseline; text-decoration: none; color: var(--hb-ink-2); padding: .22rem .4rem; border-radius: 6px; font-size: .84rem; line-height: 1.3; border-left: 2px solid transparent; }
.hb-toc a span { font-family: var(--hb-mono); font-size: .7rem; color: var(--hb-ink-3); font-variant-numeric: tabular-nums; }
.hb-toc a:hover { background: var(--hb-surface); color: var(--hb-ink); }
.hb-toc a.hb-actief { background: var(--hb-surface); color: var(--hb-ink); border-left-color: var(--hb-accent-bright); font-weight: 500; }
.hb-toc a.hb-actief span { color: var(--hb-accent); }
@media (max-width: 1079px) {
  .hb-rail { position: static; max-height: none; }
  .hb-toc { border: 1px solid var(--hb-line); background: var(--hb-surface); border-radius: 10px; padding: .9rem 1rem; max-height: 360px; }
}

.hb-main { display: flex; flex-direction: column; gap: 2.4rem; min-width: 0; }
.hb-deel { scroll-margin-top: 1rem; }
.hb-deel > header { border-top: 3px solid var(--hb-accent-bright); padding-top: .85rem; margin-bottom: 1rem; }
.hb-rom { font-family: var(--hb-mono); font-size: .73rem; letter-spacing: .16em; color: var(--hb-accent); }
.hb-deel > header h2 { font-size: clamp(1.55rem, 3vw, 2rem); line-height: 1.15; margin-top: .18rem; }
.hb-deel-intro { color: var(--hb-ink-3); font-style: italic; margin-top: .4rem; }
.hb-stapel { display: flex; flex-direction: column; gap: .8rem; }

.hb-hst { background: var(--hb-surface); border: 1px solid var(--hb-line); border-radius: 10px; padding: 1.25rem 1.35rem; box-shadow: var(--hb-shadow); scroll-margin-top: 1rem; }
.hb-hst > h3 { font-size: 1.14rem; line-height: 1.25; display: flex; gap: .55rem; align-items: baseline; }
.hb-hst > h3 .hb-nr { font-family: var(--hb-mono); font-size: .77rem; color: var(--hb-accent); flex: none; font-variant-numeric: tabular-nums; }
.hb-body > * { margin-top: .7rem; }
.hb-body > *:first-child { margin-top: .5rem; }
.hb-body p { color: var(--hb-ink-2); font-size: .94rem; }
.hb-body h4 { font-size: .97rem; color: var(--hb-ink); margin-top: 1rem; }
.hb-body em { color: var(--hb-ink-2); }

.hb-body ul.lijst { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: .38rem; }
.hb-body ul.lijst li { position: relative; padding-left: 1.05rem; color: var(--hb-ink-2); font-size: .93rem; }
.hb-body ul.lijst li::before { content: ""; position: absolute; left: 0; top: .62em; width: 5px; height: 5px; border-radius: 50%; background: var(--hb-accent-bright); }
.hb-body ul.lijst li strong { color: var(--hb-ink); }

.hb-body .kv { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(232px, 1fr)); }
.hb-body .kv > div { border: 1px solid var(--hb-line-soft); background: var(--hb-surface-2); border-radius: 8px; padding: .6rem .75rem; }
.hb-body .kv b { display: block; font-family: var(--hb-serif); font-size: .99rem; color: var(--hb-ink); }
.hb-body .kv span { font-size: .86rem; color: var(--hb-ink-3); }

.hb-body .let { border-left: 3px solid var(--hb-accent-bright); background: var(--hb-accent-wash); border-radius: 0 10px 10px 0; padding: .72rem 1rem; }
.hb-body .let.waarschuwing { border-left-color: var(--hb-warn); background: var(--hb-warn-wash); }
.hb-body .let.gunstig { border-left-color: var(--hb-good); background: var(--hb-good-wash); }
.hb-body .let.gevaar { border-left-color: var(--hb-bad); background: var(--hb-bad-wash); }
.hb-body .let p { font-size: .9rem; color: var(--hb-ink-2); max-width: none; }
.hb-body .let strong { color: var(--hb-ink); }

.hb-body .tabel-wrap { overflow-x: auto; border: 1px solid var(--hb-line); border-radius: 8px; }
.hb-body table { border-collapse: collapse; width: 100%; min-width: 540px; font-size: .87rem; }
.hb-body thead th { background: var(--hb-ink-deep); color: #FFF; text-align: left; font-weight: 500; font-family: var(--hb-mono); font-size: .69rem; letter-spacing: .07em; text-transform: uppercase; padding: .5rem .7rem; }
.hb-body tbody td { padding: .48rem .7rem; border-top: 1px solid var(--hb-line-soft); vertical-align: top; color: var(--hb-ink-2); }
.hb-body tbody tr:nth-child(even) td { background: var(--hb-surface-2); }
.hb-body tbody td:first-child { color: var(--hb-ink); font-weight: 500; }
.hb-body table.tab-breed { min-width: 620px; }
/* Sommige routepaden zijn honderd tekens lang (de wallet-webservice); zonder
   afbreken duwt zo'n pad de hele tabel uit beeld. */
.hb-body table.tab-breed td:first-child { max-width: 32ch; overflow-wrap: anywhere; }
.hb-body table.tab-breed td:first-child code { white-space: normal; }
.hb-body table.tab-breed td:last-child { min-width: 30ch; }
.hb-body .mono, .hb-body td.mono { font-family: var(--hb-mono); font-variant-numeric: tabular-nums; font-size: .93em; color: var(--hb-accent); white-space: nowrap; }

.hb-body .stroom { display: flex; align-items: stretch; gap: .45rem; overflow-x: auto; padding-bottom: .3rem; }
.hb-body .stap { flex: 1 1 0; min-width: 148px; background: var(--hb-surface-2); border: 1px solid var(--hb-line); border-radius: 8px; padding: .58rem .7rem; }
.hb-body .stap b { display: block; font-family: var(--hb-serif); font-size: .97rem; color: var(--hb-ink); }
.hb-body .stap span { font-size: .82rem; color: var(--hb-ink-3); }
.hb-body .stap.goed { border-color: var(--hb-good); background: var(--hb-good-wash); }
.hb-body .stap.let-op { border-color: var(--hb-warn); background: var(--hb-warn-wash); }
.hb-body .stap.koel { border-color: var(--hb-cool); background: var(--hb-cool-wash); }
.hb-body .stap.fout { border-color: var(--hb-bad); background: var(--hb-bad-wash); }
.hb-body .pijl { flex: none; align-self: center; color: var(--hb-accent-bright); font-family: var(--hb-mono); }

.hb-body .chips { display: flex; flex-wrap: wrap; gap: .32rem; }
.hb-body .chip { font-family: var(--hb-mono); font-size: .72rem; border-radius: 999px; padding: .2rem .58rem; border: 1px solid var(--hb-line); background: var(--hb-surface-2); color: var(--hb-ink-2); }
.hb-body .chip.bad { border-color: var(--hb-bad); color: var(--hb-bad); background: var(--hb-bad-wash); }
.hb-body .chip.warn { border-color: var(--hb-warn); color: var(--hb-warn); background: var(--hb-warn-wash); }
.hb-body .chip.good { border-color: var(--hb-good); color: var(--hb-good); background: var(--hb-good-wash); }
.hb-body .chip.cool { border-color: var(--hb-cool); color: var(--hb-cool); background: var(--hb-cool-wash); }

.hb-body code { font-family: var(--hb-mono); font-size: .86em; background: var(--hb-surface-2); border: 1px solid var(--hb-line-soft); border-radius: 4px; padding: .03rem .28rem; color: var(--hb-ink-2); }
.hb-verborgen { display: none !important; }
.hb-slot { border-top: 1px solid var(--hb-line); padding-top: 1.2rem; color: var(--hb-ink-3); font-size: .85rem; }
`;
