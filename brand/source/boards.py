"""Builds the HTML sources for the raster boards (preview, brand board, GitHub social preview).
Render each with render_png.py (headless Chrome). Logos are inlined from the kit's own SVG files."""
import os, re
KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(KIT, "source")


def svg(rel, **kw):
    s = open(os.path.join(KIT, rel), encoding="utf-8").read()
    s = re.sub(r'\swidth="[\d.]+" height="[\d.]+"', "", s, count=1)
    s = s.replace('aria-labelledby="title"', 'aria-hidden="true"')
    s = re.sub(r"<title[^>]*>.*?</title>", "", s)
    if "cls" in kw:
        s = s.replace("<svg ", f'<svg class="{kw["cls"]}" ', 1)
    return s


FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700'
         '&family=IBM+Plex+Mono:wght@400;500&display=swap">')
BASE = """*{box-sizing:border-box}body{margin:0;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:'IBM Plex Mono',monospace}svg{display:block}"""


def construction():
    """Symbol with its construction: guide circles, centres, offset and stroke dimensions."""
    g = "#64748B"
    return f'''<svg viewBox="-20 -10 296 276" aria-hidden="true">
<g fill="none" stroke="{g}" stroke-width="1" stroke-dasharray="4 4" opacity=".75">
<circle cx="128" cy="140" r="104"/><circle cx="128" cy="140" r="64"/>
<circle cx="128" cy="116" r="104"/><circle cx="128" cy="116" r="64"/>
<line x1="128" y1="-4" x2="128" y2="260"/><line x1="0" y1="128" x2="256" y2="128"/></g>
<path fill="#38BDF8" opacity=".92" d="{open(os.path.join(KIT,'opsentra-icon.svg')).read().split(' d="')[1].split('"')[0]}"/>
<g fill="#F8FAFC"><circle cx="128" cy="140" r="3.5"/><circle cx="128" cy="116" r="3.5"/></g>
<g font-family="'IBM Plex Mono', monospace" font-size="9" fill="#CBD5E1">
<text x="134" y="112">c₂</text><text x="134" y="152">c₁</text>
<text x="226" y="40">r 104 / 64</text><text x="-16" y="236">stroke 40</text><text x="140" y="262">shift ±12</text></g></svg>'''


def preview():
    return f'''<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{BASE}
body{{width:1600px;height:1000px;background:#E9EDF2;padding:40px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr 150px;gap:20px}}
.t{{border-radius:18px;display:grid;place-items:center;position:relative}}.t svg{{width:440px}}
.lab{{position:absolute;left:24px;bottom:18px;font-size:13px;color:#64748B}}.dk .lab{{color:#94A3B8}}
.row{{grid-column:1/3;background:#fff;border-radius:18px;display:flex;align-items:center;gap:44px;padding:0 40px}}
.row svg{{flex:none}}.row .lab{{position:static}}</style></head><body>
<div class="t" style="background:#fff">{svg("opsentra-logo-primary.svg")}<span class="lab">Primary · light backgrounds</span></div>
<div class="t dk" style="background:#0B1220">{svg("opsentra-logo-dark.svg")}<span class="lab">Dark backgrounds</span></div>
<div class="t" style="background:#F1F5F9">{svg("opsentra-monochrome.svg")}<span class="lab">Monochrome black</span></div>
<div class="t dk" style="background:#000">{svg("variants/opsentra-monochrome-white.svg")}<span class="lab">Monochrome white</span></div>
<div class="row">{svg("opsentra-icon.svg").replace("<svg ", '<svg style="width:96px" ',1)}
{svg("variants/opsentra-icon-small.svg").replace("<svg ", '<svg style="width:48px" ',1)}
{svg("variants/opsentra-icon-small.svg").replace("<svg ", '<svg style="width:32px" ',1)}
{svg("variants/opsentra-icon-small.svg").replace("<svg ", '<svg style="width:16px" ',1)}
{svg("variants/opsentra-app-icon.svg").replace("<svg ", '<svg style="width:96px" ',1)}
<span class="lab">Symbol 96 px · small-size cut 48 / 32 / 16 px · app icon</span></div></body></html>'''


def board():
    sw = [("Ops Navy", "#0B1220", "Primary background · ink on light", "#F8FAFC"),
          ("Surface", "#172338", "Cards and panels on dark", "#F8FAFC"),
          ("Signal", "#38BDF8", "Accent on dark · 8.7:1 on navy", "#0B1220"),
          ("Signal Deep", "#0284C7", "Accent on light · symbol colour", "#F8FAFC"),
          ("Cloud", "#F8FAFC", "Text on dark · light background", "#0B1220"),
          ("Slate", "#94A3B8", "Secondary text on dark", "#0B1220")]
    st = [("Healthy", "#34D399", "#047857"), ("Warning", "#FBBF24", "#B45309"), ("Critical", "#FB7185", "#BE123C")]
    swatches = "".join(f'<div class="sw" style="background:{h};color:{fg}"><b>{n}</b><span class="mono">{h}</span>'
                       f'<small>{u}</small></div>' for n, h, u, fg in sw)
    status = "".join(f'<div class="st"><i style="background:{d}"></i><b>{n}</b><span class="mono">{d} dark UI</span>'
                     f'<span class="mono">{l} light UI</span></div>' for n, d, l in st)
    return f'''<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{BASE}
body{{width:1920px;height:1200px;background:#0B1220;color:#F8FAFC;padding:56px;display:grid;
grid-template-columns:620px 1fr 1fr;grid-template-rows:auto 1fr 1fr;gap:24px}}
.c{{background:#172338;border:1px solid #24324A;border-radius:20px;padding:28px;position:relative;overflow:hidden}}
h1{{font-size:15px;font-weight:500;color:#94A3B8;margin:0 0 18px;letter-spacing:.02em}}
.head{{grid-column:1/4;display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px}}
.head svg{{width:330px}}.head p{{margin:0;color:#94A3B8;font-size:15px}}
.hero{{grid-row:2/4;display:flex;flex-direction:column}}.hero .con{{flex:1;display:grid;place-items:center}}.hero .con svg{{width:480px}}
.hero p{{color:#CBD5E1;font-size:15px;line-height:1.55;margin:0}}
.sws{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}.sw{{border-radius:12px;padding:16px;height:118px;display:flex;flex-direction:column;gap:2px;border:1px solid #24324A}}
.sw b{{font-size:15px}}.sw span{{font-size:13px;opacity:.9}}.sw small{{margin-top:auto;font-size:11.5px;opacity:.8}}
.sts{{display:flex;gap:12px;margin-top:14px}}.st{{flex:1;background:#0B1220;border-radius:12px;padding:12px 14px;display:grid;grid-template-columns:12px 1fr;column-gap:10px;row-gap:2px;align-items:center;font-size:12px;color:#94A3B8}}
.st i{{width:10px;height:10px;border-radius:50%;grid-row:1}}.st b{{color:#F8FAFC;font-size:14px}}.st span{{grid-column:2}}
.type .big{{font-size:64px;font-weight:600;letter-spacing:-.03em;line-height:1}}.type .sub{{color:#94A3B8;margin:10px 0 22px;font-size:15px}}
.type .mono{{font-size:15px;color:#38BDF8}}.type .row{{display:flex;gap:28px;margin-top:18px;font-size:13px;color:#94A3B8}}
.app{{display:grid;grid-template-columns:200px 1fr;padding:0}}.side{{background:#0B1220;padding:22px 18px;border-right:1px solid #24324A}}
.side svg{{width:150px;margin-bottom:26px}}.nav{{font-size:13px;color:#94A3B8;padding:8px 10px;border-radius:8px}}.nav.on{{background:#172338;color:#F8FAFC}}
.main{{padding:22px 24px}}.inc{{background:#0B1220;border:1px solid #24324A;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;font-size:13.5px}}
.pill{{white-space:nowrap;font-size:11px;padding:3px 9px;border-radius:999px;font-weight:600}}.t{{margin-left:auto;color:#64748B;font-size:12px;white-space:nowrap}}.kp{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}}.kp div{{background:#0B1220;border:1px solid #24324A;border-radius:12px;padding:12px 14px;font-size:12px;color:#94A3B8}}.kp b{{display:block;color:#F8FAFC;font-size:22px;font-weight:600;letter-spacing:-.02em;margin-top:4px}}
.small{{display:flex;align-items:flex-end;gap:26px}}.small div{{text-align:center;font-size:11px;color:#64748B}}.small svg{{margin:0 auto 8px}}
.cs{{display:flex;gap:22px;align-items:center;font-size:12.5px;color:#94A3B8;line-height:1.5}}.cs .box{{flex:none;border:1px dashed #38BDF8;padding:20px;border-radius:4px}}.cs svg{{width:200px}}.lt{{background:#F8FAFC;border-radius:12px;padding:20px;margin-top:18px;display:flex;gap:30px;align-items:center}}.lt svg{{width:230px}}</style></head><body>
<div class="head">{svg("opsentra-logo-dark.svg")}<p>Brand identity v1.0 · Monitor. Detect. Respond. Recover.</p></div>
<div class="c hero"><h1>SYMBOL · CONTINUITY SHIFT</h1><div class="con">{construction()}</div>
<p>One ring, split on its vertical axis. The left half drops, the right half rises, and their end faces still overlap:
an incident is a shift in a system that never stops being one piece. Detection and recovery, drawn as a single letter O.</p>
<p class="mono" style="color:#64748B;font-size:12px;margin-top:12px">256 grid · c₁ (128,140) · c₂ (128,116) · outer r 104 · inner r 64</p></div>
<div class="c"><h1>COLOUR</h1><div class="sws">{swatches}</div><div class="sts">{status}</div></div>
<div class="c type"><h1>TYPOGRAPHY</h1><div class="big">Inter</div><div class="sub">SemiBold 600 for the wordmark and headings · Regular 400 / Medium 500 for UI text</div>
<div class="mono">IBM Plex Mono — i-0a3f9c2e · p99 412 ms · MTTR 6m 14s</div>
<div class="row"><span>H1 32 / 600 / -0.02em</span><span>Body 14–16 / 400</span><span>Data 13 / Plex Mono 400</span></div>
<div class="lt">{svg("opsentra-logo-primary.svg")}<span style="color:#475569;font-size:13px">Primary lockup on light</span></div></div>
<div class="c app"><div class="side">{svg("opsentra-logo-dark.svg")}<div class="nav on">Overview</div><div class="nav">Incidents</div><div class="nav">Runbooks</div><div class="nav">Simulation Lab</div></div>
<div class="main"><h1>DASHBOARD APPLICATION</h1><div class="kp"><div>Availability<b>99.95%</b></div><div>MTTA<b class="mono" style="font-size:19px">1m 52s</b></div><div>MTTR<b class="mono" style="font-size:19px">6m 14s</b></div></div>
<div class="inc"><span class="pill" style="background:#3B1520;color:#FB7185">SEV-1</span>web-01 · HTTP 502<span class="t mono">14:02:11</span></div>
<div class="inc"><span class="pill" style="background:#3A2A0A;color:#FBBF24">SEV-3</span>checkout-fn · errors 4.2%<span class="t mono">investigating</span></div>
<div class="inc"><span class="pill" style="background:#0D3326;color:#34D399">RESOLVED</span>sg-test restored<span class="t mono">MTTR 6m 14s</span></div></div></div>
<div class="c"><h1>SMALL SIZES · APP ICON</h1><div class="small">
<div>{svg("variants/opsentra-app-icon.svg").replace("<svg ", '<svg style="width:120px" ',1)}App icon</div>
<div>{svg("variants/opsentra-icon-dark.svg").replace("<svg ", '<svg style="width:64px" ',1)}64 px</div>
<div>{svg("variants/opsentra-icon-small.svg").replace("<svg ", '<svg style="width:32px" ',1).replace("#0284C7","#38BDF8")}32 px</div>
<div>{svg("variants/opsentra-icon-small.svg").replace("<svg ", '<svg style="width:16px" ',1).replace("#0284C7","#38BDF8")}16 px</div></div>
<p style="color:#94A3B8;font-size:13px;margin:18px 0 22px;line-height:1.5">Below 32 px use the small-size cut. Minimum: symbol 16 px, horizontal lockup 96 px wide.</p><h1>CLEAR SPACE</h1><div class="cs"><div class="box">{svg("opsentra-logo-dark.svg")}</div><span>Keep <i>x</i> clear on every side, where <i>x</i> = the wordmark x-height (47% of the lockup height). Symbol alone: 25% of its width.</span></div></div>
</body></html>'''


def social():
    grid = "".join(f'<line x1="{x}" y1="0" x2="{x}" y2="640"/>' for x in range(0, 1281, 64)) + \
           "".join(f'<line x1="0" y1="{y}" x2="1280" y2="{y}"/>' for y in range(0, 641, 64))
    steps = ["Failure", "Detection", "Incident", "Investigation", "Approval", "Remediation", "Recovery"]
    flow = '<span class="ar">→</span>'.join(f"<span>{s}</span>" for s in steps)
    return f'''<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{BASE}
body{{width:1280px;height:640px;background:#0B1220;color:#F8FAFC;position:relative;overflow:hidden}}
.g{{position:absolute;inset:0}}.g svg{{width:1280px;height:640px}}
.big{{position:absolute;right:-150px;top:50%;transform:translateY(-50%);width:620px;opacity:.07}}
.in{{position:absolute;left:96px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}}
.in > svg{{width:560px}}.tag{{font-size:30px;font-weight:500;color:#CBD5E1;margin:36px 0 0;letter-spacing:-.01em}}
.desc{{font-size:19px;color:#94A3B8;margin:14px 0 0;max-width:720px;line-height:1.5}}
.flow{{position:absolute;left:96px;bottom:56px;font-size:15px;color:#94A3B8;display:flex;gap:10px}}
.flow .ar{{color:#38BDF8}}.flow span:last-child{{color:#34D399}}</style></head><body>
<div class="g"><svg viewBox="0 0 1280 640"><g stroke="#172338" stroke-width="1">{grid}</g></svg></div>
{svg("variants/opsentra-icon-dark.svg", cls="big")}
<div class="in">{svg("opsentra-logo-dark.svg")}<p class="tag">Monitor. Detect. Respond. Recover.</p>
<p class="desc">Cloud operations, observability and incident response for AWS infrastructure.</p></div>
<div class="flow mono">{flow}</div></body></html>'''


for name, fn in [("preview", preview), ("brand-board", board), ("social", social)]:
    open(os.path.join(SRC, f"{name}.html"), "w", encoding="utf-8").write(fn())
print("ok")
