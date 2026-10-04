/** Product-level hierarchy layered over the compact local dashboard base styles. */
export const GUIDE_PRODUCT_CSS = String.raw`
[hidden]{display:none!important}
.eyebrow{display:block;color:var(--muted);font-size:.72rem;font-weight:900;letter-spacing:.08em;margin-bottom:.35rem}
.dashboard-status{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;background:linear-gradient(145deg,var(--panel),var(--panel-soft));border:1px solid var(--line);border-radius:var(--radius);padding:1.35rem;box-shadow:var(--shadow);margin:1rem 0}
.dashboard-status h2{margin:.15rem 0 .45rem;font-size:1.35rem}
.dashboard-status p{color:var(--muted);margin:.25rem 0 1rem;max-width:720px}
.dashboard-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.55fr);gap:.9rem;margin:1rem 0}
.dashboard-columns>.panel h2{margin-top:0}
.status-list{display:grid;gap:.15rem}
.status-row{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.72rem 0;border-bottom:1px solid var(--line)}
.status-row:last-child{border-bottom:0}
.checklist{display:grid;gap:.25rem}
.check-row{display:grid;grid-template-columns:28px 1fr;gap:.5rem;padding:.55rem 0}
.check-row p{margin:.15rem 0}
.check-icon{display:grid;place-items:center;width:24px;height:24px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-weight:900}
.check-icon.done{background:var(--good-soft);border-color:color-mix(in srgb,var(--good) 35%,var(--line));color:var(--good)}
.setup-intro{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:start;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 30%,var(--line));border-radius:var(--radius);padding:1rem 1.15rem;margin:1rem 0}
.setup-intro h2{margin:.1rem 0 .3rem}
.setup-intro p{margin:.2rem 0;color:var(--muted)}
.setup-step{margin:1.6rem 0}
.step-heading{display:grid;grid-template-columns:34px 1fr;gap:.65rem;align-items:start;margin-bottom:.7rem}
.step-number{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--accent);color:#fff;font-weight:900}
.step-heading h2{margin:0}
.step-heading p{margin:.2rem 0;color:var(--muted)}
.connection-overview{display:grid;gap:.75rem}
.connection-summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem}
.connection-summary p{margin:.15rem 0 0}
.connection-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.connection-table{min-width:100%}
.connection-row{display:grid;grid-template-columns:var(--connection-template);align-items:center;gap:.8rem;padding:1rem;border-bottom:1px solid var(--line)}
.connection-row:last-child{border-bottom:0}
.connection-head{background:var(--panel-soft);color:var(--muted);font-size:.8rem}
.connection-name{display:grid;gap:.25rem;min-width:0}
.connection-cell,.connection-action{min-width:0}
.connection-action{display:flex;justify-content:flex-end}
.tool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
.candidate-comparison-toolbar{grid-column:1/-1;justify-content:flex-end;align-self:start}
.tool-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1rem;box-shadow:var(--shadow)}
.tool-card.experimental{border-style:dashed}
.tool-card.compact{box-shadow:none}
.tool-card>p{color:var(--muted);margin:.65rem 0}
.tool-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}
.tool-head h3{margin:0}
.tool-facts{display:grid;grid-template-columns:auto 1fr;gap:.3rem .75rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:.65rem 0;margin:.65rem 0}
.tool-facts span{color:var(--muted);font-size:.8rem}
.tool-facts strong{font-size:.85rem}
.connection-role{max-width:45ch;line-height:1.5}
.connection-item{border-bottom:1px solid var(--line)}
.connection-item:last-child{border-bottom:0}
.connection-item>.connection-row{border:0}
.optimizer-identity{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.optimizer-identity>strong{font-size:.95rem}
.project-link{display:inline-flex;align-items:center;gap:.3rem;min-height:32px;color:var(--accent);font-size:.78rem;font-weight:600;text-decoration:underline;text-underline-offset:3px;border-radius:4px}
.project-link:hover{color:var(--text)}
.external-link-icon{font-size:.9rem;text-decoration:none}
.optimizer-claim{display:grid;gap:.3rem;min-width:0;align-content:start}
.optimizer-claim>strong{font-size:1.05rem;font-variant-numeric:tabular-nums}
.connection-head .optimizer-claim{font-size:inherit}
.optimizer-claims-note{margin:0 .15rem;max-width:90ch;line-height:1.55}
.feature-explanation>summary{min-height:44px;align-content:center;font-size:.8rem;color:var(--accent);border-radius:6px}
.feature-explanation>summary:hover{color:var(--text)}
.feature-explanation[open]>summary{color:var(--text)}
.optimizer-explanation{padding:0 1rem .35rem}
.explanation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;padding:.25rem 0 .8rem}
.explanation-grid>.explain-box{margin:0;min-width:0}
.feature-explanation .explain-box{font-size:.85rem;line-height:1.6}
.feature-explanation .explain-box>strong{font-size:.82rem}
.routing-explanation{border-top:1px solid var(--line);margin-top:.6rem}
.routing-explanation .explain-box{background:var(--panel)}
.setup-choice-list{display:grid;gap:.55rem;margin:.9rem 0}
.setup-choice-list h3{margin:.25rem 0 0}
.setup-choice{display:grid;grid-template-columns:auto 1fr;align-items:start;gap:.7rem;padding:.8rem;border:1px solid var(--line);border-radius:12px;background:var(--panel);cursor:pointer}
.setup-choice:hover{border-color:var(--accent);background:var(--accent-soft)}
.setup-choice input{inline-size:1.1rem;block-size:1.1rem;margin:.15rem 0 0;accent-color:var(--accent)}
.setup-choice-copy{display:grid;gap:.2rem}
.setup-choice-limitation{color:var(--muted)}
.routing-feature{margin:.8rem 0;padding:.8rem;border:1px solid var(--line);border-radius:12px;background:var(--panel-soft)}
.routing-feature .tool-head{align-items:center}
.routing-feature p{margin:.55rem 0;color:var(--muted)}
.managed-action-box{margin-top:.8rem;background:var(--panel-soft);border:1px solid var(--line);border-radius:12px;padding:.85rem}
.managed-action-box p{margin:.1rem 0 .65rem}
.maintenance-list{display:grid;gap:.55rem}
.maintenance-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.8rem}
.maintenance-row p{margin:.15rem 0}
.explain-box{background:var(--panel-soft);border:1px solid var(--line);border-radius:12px;padding:.8rem;margin:.6rem 0}
.explain-box p{margin:.25rem 0;color:var(--muted)}
.explain-box.warn{background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 35%,var(--line))}
.explain-box.safe{background:var(--good-soft);border-color:color-mix(in srgb,var(--good) 30%,var(--line))}
.operation-progress{margin:.75rem 0;padding:.8rem;border:1px solid var(--line);border-radius:12px}
.operation-progress p{margin:.35rem 0 0}
.choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin:.8rem 0}
.choice-button{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:.25rem;background:var(--panel);color:var(--text);border:1px solid var(--line);padding:.8rem}
.choice-button:hover:not(:disabled){border-color:var(--accent);background:var(--accent-soft)}
.choice-button .caption{font-weight:500}
.result-signal{display:grid;gap:.2rem;border-top:1px solid var(--line);padding:.65rem 0}
.result-signal strong{font-size:1rem}
.results-header{display:flex;justify-content:space-between;gap:1rem;align-items:end;margin:1rem 0}
.results-header h2{margin:0}
.results-header p{margin:.2rem 0;color:var(--muted)}
.update-notice{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;margin:.8rem 0;border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));border-radius:var(--radius);background:var(--accent-soft)}
.update-notice p{margin:.2rem 0 0;color:var(--muted)}
.inline-actions a.secondary{display:inline-flex;align-items:center;padding:.68rem 1rem;border-radius:10px;text-decoration:none;font-weight:700}
/* Shared form controls, including search, use the same sizing and theme tokens. */
input:not([type="checkbox"]):not([type="radio"]),select,textarea{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--control-line);border-radius:10px;padding:.65rem .75rem;min-height:44px;max-width:100%}input::placeholder{color:var(--muted);opacity:1}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button{min-height:44px}h2,h3{line-height:1.25;text-wrap:balance}p{overflow-wrap:anywhere}
:root{--on-accent:#fff;--control-line:#8190a5;--muted:#596579;--shadow:0 2px 8px rgba(28,39,61,.03)}:root[data-theme="dark"]{--on-accent:#101a30;--control-line:#5f7088;--muted:#a6b0c0;--shadow:none}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--on-accent:#101a30;--control-line:#5f7088;--muted:#a6b0c0;--shadow:none}}button:not(.secondary):not(.text-button):not(.choice-button):not([role="tab"]),.brand-mark{color:var(--on-accent)}
.page-heading h1{font-size:1.8rem}
.page-heading p{font-size:.95rem}
.status-line{font-size:.8rem}
.dashboard-status{background:var(--panel);padding:1.15rem;align-items:center;box-shadow:none}
.dashboard-status>div{min-width:0}
.dashboard-status h2{font-size:1.2rem}
.dashboard-status p{max-width:64ch;margin:.35rem 0 .8rem}
.dashboard-status>.pill{flex-shrink:0}
.section-title h2,.results-header h2{font-size:1.15rem}
.section-title p,.results-header p{font-size:.88rem;max-width:75ch}
.metric-card{min-height:132px;box-shadow:none;padding:1rem}
.metric-value{font-size:1.25rem;line-height:1.3;overflow-wrap:anywhere}
.metric-card.positive .metric-value,.metric-card.good .metric-value{color:var(--good)}
.metric-card.warn .metric-value{color:var(--warn)}
.metric-help{font-size:.8rem}
.advanced-disclosure{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:.8rem 1rem}
.advanced-disclosure>summary{font-size:.88rem}
.advanced-disclosure[open]>summary{margin-bottom:1rem}
main,.setup-step{scroll-margin-top:7rem}
.connection-summary{padding:.8rem 1rem}
.connection-action{gap:.4rem;flex-wrap:wrap}
.connection-action .text-button{font-size:.78rem}
.connection-app-label{display:none}
.tool-card{box-shadow:none}
.tool-head{flex-wrap:wrap}
.routing-feature .tool-head{gap:.4rem}
.routing-feature .tool-head strong{font-size:.88rem}
.routing-feature{background:var(--panel-soft)}
.maintenance-row{padding:1rem}
.maintenance-row>div{min-width:0}
.maintenance-row button{flex-shrink:0}
.maintenance-list{grid-template-columns:repeat(2,minmax(0,1fr))}
.maintenance-row{align-items:flex-start;flex-direction:column}
.brand small{font-weight:400}
.evidence-panel{padding:0;overflow:hidden;box-shadow:none}
.evidence-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,.4fr) minmax(150px,.4fr);gap:.75rem;padding:1rem;background:var(--panel-soft);border-bottom:1px solid var(--line)}
.evidence-field{display:grid;gap:.4rem;min-width:0}
.evidence-controls label{color:var(--muted);font-size:.78rem;font-weight:600}
.evidence-controls input,.evidence-controls select{width:100%;font-size:.9rem}
.evidence-list-meta{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.5rem 1rem;min-height:48px;border-bottom:1px solid var(--line)}
.evidence-list-meta p{margin:0}
.evidence-list-meta button{font-size:.8rem}
.result-evidence{list-style:none;margin:0;padding:0}
.evidence-item{border-bottom:1px solid var(--line)}
.evidence-item:last-child{border-bottom:0}
.evidence-summary{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(0,1.6fr) auto;align-items:center;gap:1.5rem;padding:1.15rem 1rem;list-style:none;font-weight:400}
.evidence-summary::-webkit-details-marker{display:none}
.evidence-summary:hover{background:var(--panel-soft)}
.evidence-identity{display:grid;gap:.3rem;min-width:0}
.evidence-identity>strong{font-size:.98rem;line-height:1.3}
.evidence-kind{font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.evidence-signals{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:.75rem;min-width:0}
.evidence-signal{display:grid;gap:.2rem;line-height:1.4}
.evidence-signal strong{font-size:1rem;font-weight:650}
.evidence-signal.good strong{color:var(--good)}
.evidence-signal.warn strong{color:var(--warn)}
.evidence-cue{display:flex;align-items:center;gap:.6rem;font-size:.8rem;color:var(--accent);font-weight:700;white-space:nowrap}
.evidence-chevron{font-size:1.5rem;font-weight:400;line-height:1}
.evidence-disclosure[open]>.evidence-summary{background:var(--panel-soft)}
.evidence-disclosure[open] .evidence-chevron{transform:rotate(90deg)}
.evidence-detail-body{display:grid;gap:1rem;padding:0 1rem 1.15rem;background:var(--panel-soft)}
.evidence-section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem}
.evidence-section h3{margin:0 0 .7rem;font-size:.88rem}
.evidence-section button{margin-top:.75rem}
.evidence-section p{margin:.75rem 0 0;max-width:90ch;line-height:1.6}
.evidence-fact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:1rem;margin:0}
.evidence-fact-grid dt{color:var(--muted);font-size:.75rem}
.evidence-fact-grid dd{margin:.25rem 0 0;font-size:.88rem;font-weight:600;overflow-wrap:anywhere}
.evidence-empty{padding:2rem 1rem;text-align:center}
.evidence-empty p{margin:.5rem 0 0;color:var(--muted);font-size:.9rem}
.result-evidence>.empty{padding:1rem}
.activity-scroll{max-height:24rem;overflow-y:auto;overscroll-behavior:contain}
.activity-scroll .activity-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--line)}
#modal{width:min(720px,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto}
#modal-content h3{margin:1rem 0 .4rem}
#modal-actions{display:flex;justify-content:flex-end;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
@media(max-width:900px){.dashboard-columns{grid-template-columns:1fr}
.tool-grid{grid-template-columns:1fr}
.setup-intro{grid-template-columns:1fr}}
@media(max-width:640px){.dashboard-status{flex-direction:column}
.choice-grid{grid-template-columns:1fr}
.connection-summary{align-items:flex-start;flex-direction:column}
.connection-action{justify-content:flex-start}
.maintenance-row{align-items:flex-start;flex-direction:column}
.results-header{align-items:flex-start;flex-direction:column}
.update-notice{align-items:flex-start;flex-direction:column}
.activity-scroll .activity-row{grid-template-columns:auto minmax(0,1fr)}
.activity-scroll .activity-row time{grid-column:2}}
@media(max-width:800px){.evidence-summary{grid-template-columns:minmax(130px,.8fr) minmax(0,1.4fr);gap:1rem}
.evidence-cue{grid-column:2}
.evidence-controls{grid-template-columns:repeat(2,minmax(0,1fr))}
.evidence-search{grid-column:1/-1}}
@media(max-width:1000px){
.connection-scroll{overflow:visible;border:0;background:transparent}
.connection-table{min-width:0;display:grid;gap:.75rem}
.connection-item{border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.connection-item:last-child{border-bottom:1px solid var(--line)}
.connection-row{display:flex;flex-wrap:wrap;gap:.85rem;padding:1rem}
.connection-head{display:none}
.connection-name{width:100%;gap:.25rem}
.connection-role{max-width:none}
.connection-cell{display:flex;align-items:center;gap:.5rem}
.connection-app-label{display:inline;color:var(--muted);font-size:.8rem}
.connection-action{width:100%;justify-content:flex-start;padding-top:.65rem;border-top:1px solid var(--line)}
.optimizer-claim{width:100%;background:var(--panel-soft);border:1px solid var(--line);border-radius:10px;padding:.75rem}
.optimizer-claim .connection-app-label{font-size:.72rem}
.optimizer-explanation{padding-top:0}}
@media(max-width:640px){.evidence-summary{grid-template-columns:1fr auto;gap:.85rem;padding:1rem}
.evidence-identity{grid-column:1}
.evidence-cue{grid-column:2;grid-row:1;align-self:start}
.evidence-signals{grid-column:1/-1}
.evidence-fact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.evidence-section{padding:.8rem}
.evidence-controls{gap:.65rem;padding:.85rem}
.evidence-controls input,.evidence-controls select{font-size:.85rem}
.maintenance-list{grid-template-columns:1fr}
.explanation-grid{grid-template-columns:1fr}
.dashboard-status{align-items:flex-start}
.brand small{display:none}
.section-title{align-items:center}
.section-title>button{flex-shrink:0}
.impact-grid{grid-template-columns:1fr}
.metric-card{min-height:0}
.header-tools select{display:block;max-width:90px;font-size:.8rem}
.header-tools{gap:.35rem}
.brand{gap:.5rem;font-size:.9rem}
.header-inner{gap:.6rem}
.header-tools button{padding:.65rem .65rem;font-size:.85rem}}
`;
