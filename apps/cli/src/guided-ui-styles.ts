/** Design system for the guided app. Local only: system fonts, no remote assets. */
export const GUIDE_UI_CSS = String.raw`
/* Layout: sticky header, one 1120px column. Home = status band, hero + side panels, KPI row. */
:root{
  color-scheme:light;
  --bg:#f4f6f9;--surface:#fff;--surface-2:#eef1f6;--line:#dce1ea;
  --ink:#121722;--ink-2:#4a5466;--ink-3:#6f7a8c;
  --accent:#3346e8;--accent-soft:#e4e7fd;--accent-ink:#fff;
  --good:#0b8f63;--good-soft:#ddf3ea;--warn:#a35f00;--warn-soft:#fbefd9;--bad:#c2363a;--bad-soft:#f9e1e1;--muted-soft:#e9ecf1;
  --chart-fill:rgba(51,70,232,.14);
  --shadow:0 1px 2px rgba(18,23,34,.05),0 8px 24px rgba(18,23,34,.06);
  --f-display:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;
  --f-body:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;
  --f-mono:"Cascadia Mono",ui-monospace,Consolas,"SFMono-Regular",monospace;
  --r:14px;--r-sm:9px;
}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0c0f15;--surface:#141922;--surface-2:#1b2230;--line:#262e3d;--ink:#eef1f6;--ink-2:#aeb6c4;--ink-3:#8590a2;--accent:#8592ff;--accent-soft:#232a52;--accent-ink:#0c0f15;--good:#3fcb95;--good-soft:#123327;--warn:#f0b25a;--warn-soft:#3a2b12;--bad:#f07a7d;--bad-soft:#3d1a1c;--muted-soft:#1f2633;--chart-fill:rgba(133,146,255,.18);--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.25)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0c0f15;--surface:#141922;--surface-2:#1b2230;--line:#262e3d;--ink:#eef1f6;--ink-2:#aeb6c4;--ink-3:#8590a2;--accent:#8592ff;--accent-soft:#232a52;--accent-ink:#0c0f15;--good:#3fcb95;--good-soft:#123327;--warn:#f0b25a;--warn-soft:#3a2b12;--bad:#f07a7d;--bad-soft:#3d1a1c;--muted-soft:#1f2633;--chart-fill:rgba(133,146,255,.18);--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.25)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button,select,input,textarea{font:inherit;color:inherit}
h1,h2,h3{margin:0;text-wrap:balance}
p{margin:0}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.wrap{max-width:1120px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:-999px;top:8px;background:var(--surface);padding:8px 12px;border-radius:8px;z-index:30}.skip:focus{left:12px}
[hidden]{display:none!important}
.caption{color:var(--ink-3);font-size:13px}
.eyebrow{display:block;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.num,.kpi-value,.big-number,.mid-number{font-variant-numeric:tabular-nums}
.grow{flex:1;min-width:0}

/* Buttons */
button{border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);padding:8px 14px;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px;line-height:1.3}
button:hover:not(:disabled){filter:brightness(1.07)}
button:disabled{opacity:.5;cursor:not-allowed}
.secondary,a.button{border:1px solid var(--line);background:var(--surface);color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;padding:8px 14px;border-radius:10px;font-weight:600;font-size:14px}
.secondary:hover:not(:disabled){filter:none;border-color:var(--ink-3)}
.ghost,.text-button{border-color:transparent;background:none;color:var(--ink-2)}
.ghost:hover:not(:disabled),.text-button:hover:not(:disabled){filter:none;background:var(--surface-2)}
.small{padding:5px 10px;font-size:13px;border-radius:8px}
.big{padding:13px 22px;font-size:16px;border-radius:12px}
.info-button{width:22px;height:22px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);font-size:12px;display:inline-grid;place-items:center}
.inline-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}

/* Header */
.app-header{position:sticky;top:env(safe-area-inset-top,0px);z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.header-inner{display:flex;align-items:center;gap:16px;min-height:62px;flex-wrap:wrap;padding-block:8px}
.brand{display:flex;align-items:center;gap:10px;font-weight:650}
.brand-mark{width:32px;height:32px;border-radius:9px;background:var(--ink);display:grid;align-content:center;gap:3px;padding:0 8px}
.brand-mark i{display:block;height:3px;border-radius:2px;background:var(--bg)}
.brand-mark i:nth-child(1){width:100%}.brand-mark i:nth-child(2){width:66%;opacity:.8}.brand-mark i:nth-child(3){width:36%;opacity:.6}
.brand-name{display:flex;flex-direction:column;line-height:1.15;letter-spacing:-.01em}
.brand-name small{font-size:11.5px;color:var(--ink-3);font-weight:500}
@media (max-width:520px){.brand-name small,.switch-label > span{display:none}.header-tools{margin-left:0}}
.view-tabs{display:flex;gap:4px}
.view-tabs button{border:0;background:none;color:var(--ink-2);padding:8px 14px;border-radius:9px;font-weight:550}
.view-tabs button:hover{filter:none;background:var(--surface-2)}
.view-tabs button[aria-selected="true"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.header-tools{margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.switch-label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2)}
.segmented{display:inline-flex;background:var(--surface-2);border-radius:9px;padding:3px;gap:2px}
.segmented button{border:0;background:none;color:var(--ink-2);padding:4px 10px;border-radius:7px;font-size:13px;font-weight:550}
.segmented button:hover{filter:none}
.segmented button[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
select,input[type="search"],input[type="number"],input:not([type]),textarea{border:1px solid var(--line);background:var(--surface);border-radius:9px;padding:7px 10px;font-size:14px;max-width:100%}
.theme-select select{padding:6px 8px;font-size:13px}

/* Switch */
.switch{position:relative;width:40px;height:23px;flex:none;border-radius:99px;background:var(--line);border:0;padding:0;transition:background .2s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.switch[aria-checked="true"]{background:var(--good)}
.switch.accent[aria-checked="true"]{background:var(--accent)}
.switch[aria-checked="true"]::after{transform:translateX(17px)}
.switch:hover:not(:disabled){filter:brightness(1.05)}

/* Status line and notices */
main{padding-block:18px 56px}
.status-line{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--ink-3);font-size:13px;margin-bottom:14px}
.read-status{display:inline-flex;align-items:center;gap:8px}
.spinner{width:13px;height:13px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.error,.stale-state,.notice-box{padding:10px 14px;border-radius:var(--r-sm);margin-bottom:12px;font-size:14px}
.error{background:var(--bad-soft);color:var(--bad)}
.stale-state,.notice-box{background:var(--warn-soft);color:var(--warn)}
.update-notice{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-radius:var(--r);background:var(--accent-soft);color:var(--ink);margin-bottom:14px}
footer{margin-top:40px;color:var(--ink-3);font-size:12.5px;text-align:center}
.page-head{margin:6px 0 18px}
.page-head h1{font-family:var(--f-display);font-weight:700;font-size:clamp(26px,3.4vw,34px);letter-spacing:-.02em}
.page-head p{color:var(--ink-2);margin-top:4px;max-width:66ch}
.empty{color:var(--ink-3);font-size:14px;padding:8px 0}

/* Cards and badges */
.card,.panel,.tool-card,.metric-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.panel{padding:18px 20px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:12.5px;font-weight:600;white-space:nowrap;background:var(--muted-soft);color:var(--ink-3)}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.active,.pill.good{background:var(--good-soft);color:var(--good)}
.pill.waiting{background:var(--accent-soft);color:var(--accent)}
.pill.action,.pill.warn{background:var(--warn-soft);color:var(--warn)}
.tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11.5px;font-weight:600;background:var(--surface-2);color:var(--ink-2)}
.tag.estimated{background:var(--warn-soft);color:var(--warn)}
.tag.measured{background:var(--good-soft);color:var(--good)}

/* Home */
.status-band{display:flex;align-items:center;gap:18px;padding:18px 22px;flex-wrap:wrap}
.status-icon{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;flex:none;position:relative;background:var(--good-soft);color:var(--good)}
.status-band.warn .status-icon{background:var(--warn-soft);color:var(--warn)}
.status-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.status-band.good .status-icon::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--good);opacity:.5;animation:ring 2.4s ease-out infinite}
@keyframes ring{from{transform:scale(.85);opacity:.6}to{transform:scale(1.35);opacity:0}}
@media (prefers-reduced-motion:reduce){.status-band.good .status-icon::after,.spinner{animation:none}}
.status-copy{min-width:0;flex:1 1 240px}
.status-copy h2{font-size:19px;font-weight:650;letter-spacing:-.01em}
.status-copy p{color:var(--ink-2);margin-top:2px}
.status-side{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.agent-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 11px 6px 9px;border:1px solid var(--line);border-radius:10px;font-size:13.5px;background:var(--surface)}
.agent-chip .dot{width:8px;height:8px;border-radius:50%;background:var(--ink-3)}
.agent-chip.active .dot,.agent-chip.waiting .dot{background:var(--good)}
.agent-chip.action .dot{background:var(--warn)}
.home-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;margin-top:16px}
@media (max-width:860px){.home-grid{grid-template-columns:1fr}}
.home-side{display:flex;flex-direction:column;gap:16px;min-width:0}
.hero{padding:22px 24px 16px;min-width:0}
.hero-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.big-number{font-family:var(--f-display);font-weight:700;font-size:clamp(46px,7vw,72px);line-height:1;letter-spacing:-.035em;margin-top:12px}
.big-number small{font-size:.32em;letter-spacing:0;font-weight:500;color:var(--ink-2);margin-left:8px}
.big-number.muted{color:var(--ink-3)}
.hero-sub{color:var(--ink-2);margin-top:8px;max-width:58ch}
.estimate{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 14px;background:var(--surface-2);border-radius:var(--r-sm);flex-wrap:wrap}
.estimate strong{font-family:var(--f-display);font-size:22px;letter-spacing:-.02em}
.estimate span{color:var(--ink-2);font-size:13.5px}
.hero .caption{margin-top:10px}
.chart{margin-top:16px}
.chart svg{display:block;width:100%;height:auto;margin-top:6px}
.chart text{fill:var(--ink-3);font-family:var(--f-mono);font-size:10.5px}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .area{fill:var(--chart-fill)}
.chart .line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round}
.chart .end{fill:var(--accent);stroke:var(--surface);stroke-width:2}
.mid-number{font-family:var(--f-display);font-weight:700;font-size:40px;letter-spacing:-.025em;line-height:1.05;margin-top:8px}
.mid-number small{font-size:14px;font-weight:500;color:var(--ink-2);margin-left:6px;letter-spacing:0}
.panel-text{color:var(--ink-2);font-size:14px;margin:8px 0 12px}
.bars{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.bar-row{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13.5px}
.bar{height:10px;background:var(--surface-2);border-radius:99px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:var(--good)}
.meters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}
@media (max-width:420px){.meters{grid-template-columns:1fr}}
.meter{display:flex;gap:12px;align-items:center;min-width:0}
.meter strong{display:block;font-size:13.5px}
.ring{width:56px;height:56px;flex:none}
.ring circle{fill:none;stroke-width:7}
.ring .track{stroke:var(--surface-2)}
.ring .value{stroke:var(--good);stroke-linecap:round;transition:stroke-dashoffset .8s}
.ring .value.mid{stroke:var(--warn)}.ring .value.low{stroke:var(--bad)}
.ring text{fill:var(--ink);font-family:var(--f-display);font-weight:700;font-size:15px}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:16px}
.kpi{padding:18px 20px}
.kpi-value{display:block;font-family:var(--f-display);font-weight:700;font-size:30px;letter-spacing:-.02em;margin-top:6px}
.kpi p{color:var(--ink-2);font-size:13.5px;margin-top:4px}

/* Methods */
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.filter{border:1px solid var(--line);background:var(--surface);color:var(--ink-2);padding:6px 12px;border-radius:99px;font-size:13.5px;font-weight:550}
.filter:hover:not(:disabled){filter:none;border-color:var(--ink-3)}
.filter[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.section-heading{display:flex;align-items:baseline;gap:10px;margin:24px 0 12px;flex-wrap:wrap}
.section-heading h2{font-size:17px;font-weight:650}
.method-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px;align-items:start}
@media (max-width:420px){.method-grid{grid-template-columns:1fr}}
.method{display:flex;flex-direction:column;gap:12px;padding:18px 18px 12px;min-width:0}
.method-head{display:flex;gap:12px;align-items:flex-start}
.method-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex:none;background:var(--accent-soft);color:var(--accent)}
.method-icon.model{background:var(--good-soft);color:var(--good)}
.method-icon.context{background:var(--warn-soft);color:var(--warn)}
.method-icon.code{background:var(--surface-2);color:var(--ink-2)}
.method-icon svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.method-title{flex:1;min-width:0}
.method-title h3{font-size:16px;font-weight:650}
.method-desc{color:var(--ink-2);font-size:14px}
.method-result{display:flex;align-items:baseline;gap:8px;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);flex-wrap:wrap}
.method-result strong{font-family:var(--f-display);font-size:20px;letter-spacing:-.015em}
.method-result span{color:var(--ink-2);font-size:13px}
.method-result.none strong{font-family:var(--f-body);font-size:14px;font-weight:550;color:var(--ink-2)}
.update-strip{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--r-sm);background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:550;flex-wrap:wrap}
.update-strip button{margin-left:auto}
.agent-tags{display:flex;gap:6px;flex-wrap:wrap}
.agent-tags span{font-size:12px;padding:2px 7px;border-radius:6px;background:var(--surface-2);color:var(--ink-2)}
.agent-list{display:flex;flex-direction:column;border-top:1px solid var(--line)}
.agent-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.agent-row:last-child{border-bottom:0}
.agent-row strong{display:block;font-size:14px}
.method-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--line);flex-wrap:wrap}
.feature-explanation summary{cursor:pointer;color:var(--accent);font-size:13.5px;font-weight:550;padding:4px 0}
.explanation-grid{display:grid;gap:8px;margin-top:8px}
.explain-box{padding:12px 14px;border-radius:var(--r-sm);background:var(--surface-2);font-size:14px}
.explain-box strong{display:block;margin-bottom:2px}
.explain-box p{color:var(--ink-2)}
.explain-box.safe{background:var(--good-soft)}
.explain-box.warn{background:var(--warn-soft)}
.project-link{display:inline-flex;gap:4px;align-items:center;font-size:13px;margin-top:6px;font-weight:550}

/* Onboarding */
.onboarding{max-width:760px;margin:18px auto 0;display:flex;flex-direction:column;gap:12px}
.onboarding h1{font-family:var(--f-display);font-weight:700;font-size:clamp(30px,4.6vw,44px);letter-spacing:-.03em;line-height:1.08}
.onboarding .lead{color:var(--ink-2);font-size:17px;max-width:58ch;margin-bottom:12px}
.onboarding .eyebrow{margin-top:12px}
.found{display:flex;gap:10px;flex-wrap:wrap}
.plan{padding:4px 0}
.plan-item{display:flex;gap:14px;padding:15px 22px;border-bottom:1px solid var(--line)}
.plan-item:last-child{border-bottom:0}
.plan-item strong{display:block}
.plan-item span{color:var(--ink-2);font-size:14px}
.plan-check{width:24px;height:24px;border-radius:50%;background:var(--good);color:#fff;display:grid;place-items:center;flex:none;font-size:13px;font-weight:700}
.onboarding-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
.todo{padding:18px 22px;border-color:var(--warn);background:var(--warn-soft)}
.todo h3{color:var(--warn);font-size:15px}
.todo p{margin:6px 0 12px}

/* Dialog */
dialog{border:0;border-radius:16px;padding:0;width:min(560px,calc(100% - 32px));max-height:calc(100% - 32px);background:var(--surface);color:var(--ink);box-shadow:0 30px 80px rgba(0,0,0,.3)}
dialog::backdrop{background:rgba(10,12,18,.45)}
.dialog-body{padding:22px 24px;display:flex;flex-direction:column;gap:12px}
.dialog-heading h2{font-size:19px;font-weight:650}
#modal-content{display:flex;flex-direction:column;gap:10px}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:6px}
.preview-change{padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-sm)}
.preview-change h3{font-size:14.5px;font-weight:650}
.preview-change p{color:var(--ink-2);font-size:13.5px;margin-top:2px}
.step-title{font-size:14px;font-weight:650;margin-top:6px}
.notice-row{color:var(--ink-3);font-size:13px}
.operation-progress{padding:12px 14px;border-radius:var(--r-sm);background:var(--surface-2)}
.command-block{display:flex;gap:8px;align-items:center;padding:8px 8px 8px 12px;border-radius:var(--r-sm);background:var(--surface-2);overflow-x:auto}
.command-block code{font-family:var(--f-mono);font-size:13px;flex:1;min-width:0;white-space:pre-wrap;word-break:break-all}
.choice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.choice-button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;background:var(--surface);color:var(--ink);border:1px solid var(--line);padding:12px 14px}
.choice-button:hover:not(:disabled){filter:none;border-color:var(--accent)}
.setup-choice-list{display:flex;flex-direction:column;gap:8px}
.setup-choice{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}
.setup-choice input{margin-top:4px;accent-color:var(--accent)}
.setup-choice-copy{display:flex;flex-direction:column}

/* Details (advanced) */
.details-section{margin-top:26px}
.details-section > h2,.section-title h2{font-size:17px;font-weight:650}
.section-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:26px 0 12px}
.section-title p{color:var(--ink-3);font-size:13px}
.impact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px}
.metric-card{padding:16px 18px}
.metric-label{display:block;font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.metric-value{display:block;font-family:var(--f-display);font-size:22px;font-weight:700;margin-top:4px;letter-spacing:-.015em}
.metric-help{color:var(--ink-2);font-size:13px;margin-top:4px}
.metric-card.positive .metric-value,.metric-card.good .metric-value{color:var(--good)}
.metric-card.warn .metric-value{color:var(--warn)}
.evidence-panel,.toolbar{display:flex;flex-direction:column;gap:12px}
.toolbar,.filter-row{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.evidence-controls{display:grid;grid-template-columns:minmax(0,2fr) repeat(2,minmax(0,1fr));gap:10px}
@media (max-width:640px){.evidence-controls{grid-template-columns:1fr}}
.evidence-field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink-2)}
.evidence-list-meta{display:flex;justify-content:space-between;align-items:center;gap:8px}
.result-evidence{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.evidence-item{border-bottom:1px solid var(--line)}
.evidence-item:last-child{border-bottom:0}
.evidence-summary{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr) auto;gap:14px;align-items:center;padding:14px 16px;cursor:pointer;list-style:none}
.evidence-summary::-webkit-details-marker{display:none}
@media (max-width:720px){.evidence-summary{grid-template-columns:1fr}}
.evidence-identity{display:flex;flex-direction:column;gap:2px;min-width:0}
.evidence-kind{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.evidence-signals{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px 14px}
.evidence-signal{display:flex;flex-direction:column;min-width:0}
.evidence-signal.good strong{color:var(--good)}.evidence-signal.warn strong{color:var(--warn)}
.evidence-cue{color:var(--accent);font-size:13px;font-weight:550;display:inline-flex;gap:4px;align-items:center}
.evidence-disclosure[open] .evidence-chevron{transform:rotate(90deg)}
.evidence-chevron{transition:transform .15s}
.evidence-detail-body{display:flex;flex-direction:column;gap:12px;padding:0 16px 16px}
.evidence-section{padding:12px 14px;background:var(--surface-2);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px}
.evidence-section h3{font-size:14px;font-weight:650}
.evidence-fact-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 14px;margin:0}
.evidence-fact-grid dt{font-size:12px;color:var(--ink-3)}
.evidence-fact-grid dd{margin:0;font-weight:600;font-size:14px;overflow-wrap:anywhere}
.evidence-empty{padding:14px;text-align:center;color:var(--ink-2)}
.maintenance-list,.activity-scroll{display:flex;flex-direction:column;gap:8px}
.activity-scroll{max-height:420px;overflow:auto}
.maintenance-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);flex-wrap:wrap}
.maintenance-row > div{min-width:0;flex:1}
.activity-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.tool-card{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.tool-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.tool-head h3{font-size:15px;font-weight:650}
.tool-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13.5px}
.tool-facts span{color:var(--ink-3)}
.agent-details summary{cursor:pointer;color:var(--accent);font-size:13.5px;font-weight:550}
.status-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
`;
