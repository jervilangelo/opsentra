"""Opsentra brand kit generator — single source of truth for every vector asset.

Usage:  python build_kit.py <path-to-Inter-SemiBold.ttf>

Symbol "Continuity Shift" (256 grid):
  master   outer r 104, stroke 40, left half centred (128,140), right half centred (128,116)
  small    outer r 112, stroke 42, offset 12 — favicon / <= 32 px cut
Wordmark: "opsentra", Inter SemiBold outlined to paths, GPOS kerning applied, tracking -0.02 em.
"""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)

C = {
    "navy": "#0B1220", "surface": "#172338", "white": "#F8FAFC",
    "signal": "#38BDF8",       # accent on dark
    "signal_deep": "#0284C7",  # accent on light
}


# ---------------------------------------------------------------- symbol
def half(cx, cy, ro, ri, side):
    s1, s2 = ("0", "1") if side == "L" else ("1", "0")
    return f"M{cx} {cy-ro}A{ro} {ro} 0 0 {s1} {cx} {cy+ro}V{cy+ri}A{ri} {ri} 0 0 {s2} {cx} {cy-ri}Z"


def symbol_d(ro=104, w=40, d=12):
    return half(128, 128 + d, ro, ro - w, "L") + half(128, 128 - d, ro, ro - w, "R")


MASTER = symbol_d()
SMALL = symbol_d(112, 42, 12)
SYM_BBOX = (24, 12, 232, 244)  # x0 y0 x1 y1 of MASTER


# ---------------------------------------------------------------- wordmark
def kerning(font):
    """Return {(left, right): xAdvance} from GPOS PairPos (formats 1 and 2)."""
    pairs, classes = {}, []
    gpos = font["GPOS"].table
    for li in gpos.FeatureList.FeatureRecord:
        if li.FeatureTag != "kern":
            continue
        for idx in li.Feature.LookupListIndex:
            lk = gpos.LookupList.Lookup[idx]
            subs = lk.SubTable
            for st in subs:
                if lk.LookupType == 9:
                    if st.ExtensionLookupType != 2:
                        continue
                    st = st.ExtSubTable
                elif lk.LookupType != 2:
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for g, ps in zip(cov, st.PairSet):
                        for pvr in ps.PairValueRecord:
                            v = getattr(pvr.Value1, "XAdvance", 0) or 0
                            pairs.setdefault((g, pvr.SecondGlyph), v)
                elif st.Format == 2:
                    classes.append((set(cov), st.ClassDef1.classDefs, st.ClassDef2.classDefs, st.Class1Record))
    return pairs, classes


def kern_value(l, r, pairs, classes):
    if (l, r) in pairs:
        return pairs[(l, r)]
    for cov, cd1, cd2, recs in classes:
        if l in cov:
            v = recs[cd1.get(l, 0)].Class2Record[cd2.get(r, 0)].Value1
            return getattr(v, "XAdvance", 0) or 0 if v else 0
    return 0


def wordmark(font_path, text="opsentra", size=132.0, tracking_em=-0.02):
    f = TTFont(font_path)
    gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f["hmtx"]
    upm = f["head"].unitsPerEm
    s = size / upm
    pairs, classes = kerning(f)
    names = [cmap[ord(c)] for c in text]
    x, d_all, bp = 0.0, [], BoundsPen(gs)
    first_lsb = None
    for i, g in enumerate(names):
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
        gs[g].draw(TransformPen(bp, (s, 0, 0, -s, x, 0)))
        d_all.append(pen.getCommands())
        if first_lsb is None:
            first_lsb = hmtx[g][1] * s
        adv = hmtx[g][0]
        if i + 1 < len(names):
            adv += kern_value(g, names[i + 1], pairs, classes)
        x += adv * s + tracking_em * size
    return "".join(d_all), bp.bounds, f["OS/2"].sxHeight * s   # path at baseline y=0, x starting at 0


# ---------------------------------------------------------------- lockup
def lockup(word_d, word_bounds, xh):
    """Horizontal lockup on a tight viewBox. Symbol scale .66; symbol centred on the x-height band;
    visible gap between symbol and 'o' = 0.32 x symbol width."""
    k = 0.66
    sx0, sy0, sx1, sy1 = [v * k for v in SYM_BBOX]
    sw, sh = sx1 - sx0, sy1 - sy0
    wx0, wy0, wx1, wy1 = word_bounds              # wy0 negative-up already flipped: y range [wy0, wy1]
    # place symbol: left edge at 0, vertical centre at x-height centre (baseline = B)
    B = 0.0
    xcen = B - xh / 2
    ty = xcen - (sy0 + sh / 2)
    tx = -sx0
    gap = 0.32 * sw
    wx = sw + gap - wx0                            # shift word so its ink starts after the gap
    top = min(ty + sy0, wy0)
    bot = max(ty + sy1, wy1)
    W, H = wx + wx1, bot - top
    # normalise so the viewBox starts at 0,0
    oy = -top
    return {
        "W": round(W, 2), "H": round(H, 2),
        "sym_tf": f"translate({tx:.2f} {ty + oy:.2f}) scale({k})",
        "word_tf": f"translate({wx:.2f} {B + oy:.2f})",
        "word_d": word_d, "sym_h": sh, "xh": xh,
    }


def lockup_svg(L, sym_fill, word_fill, title="Opsentra", bg=None):
    W, H = L["W"], L["H"]
    b = f'<rect width="{W}" height="{H}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
            f'aria-labelledby="title"><title id="title">{title}</title>{b}'
            f'<path id="symbol" fill="{sym_fill}" transform="{L["sym_tf"]}" d="{MASTER}"/>'
            f'<path id="wordmark" fill="{word_fill}" transform="{L["word_tf"]}" d="{L["word_d"]}"/></svg>\n')


def symbol_svg(d, fill, title="Opsentra symbol", bg=None, rx=0, inner_scale=1.0):
    b = f'<rect width="256" height="256" rx="{rx}" fill="{bg}"/>' if bg else ""
    tf = ""
    if inner_scale != 1.0:
        o = 128 * (1 - inner_scale)
        tf = f' transform="translate({o:g} {o:g}) scale({inner_scale:g})"'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" '
            f'aria-labelledby="title"><title id="title">{title}</title>{b}<path fill="{fill}"{tf} d="{d}"/></svg>\n')


def favicon_svg():
    # Adapts to the browser's colour scheme; falls back to the light-UI colour.
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
            '<title>Opsentra</title><style>path{fill:#0284C7}@media (prefers-color-scheme:dark){path{fill:#38BDF8}}</style>'
            f'<path d="{SMALL}"/></svg>\n')


def write(rel, s):
    p = os.path.join(KIT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(s)


if __name__ == "__main__":
    d, bounds, xh = wordmark(sys.argv[1])
    L = lockup(d, bounds, xh)
    # Required deliverables
    write("opsentra-logo-primary.svg", lockup_svg(L, C["signal_deep"], C["navy"], "Opsentra"))
    write("opsentra-logo-light.svg", lockup_svg(L, C["signal_deep"], C["navy"], "Opsentra (for light backgrounds)"))
    write("opsentra-logo-dark.svg", lockup_svg(L, C["signal"], C["white"], "Opsentra (for dark backgrounds)"))
    write("opsentra-monochrome.svg", lockup_svg(L, "#000000", "#000000", "Opsentra (monochrome)"))
    write("opsentra-icon.svg", symbol_svg(MASTER, C["signal_deep"]))
    write("favicon.svg", favicon_svg())
    # Supporting variants
    write("variants/opsentra-monochrome-white.svg", lockup_svg(L, "#FFFFFF", "#FFFFFF", "Opsentra (monochrome white)"))
    write("variants/opsentra-logo-dark-bg.svg", lockup_svg(L, C["signal"], C["white"], "Opsentra", bg=C["navy"]))
    write("variants/opsentra-icon-dark.svg", symbol_svg(MASTER, C["signal"]))
    write("variants/opsentra-icon-black.svg", symbol_svg(MASTER, "#000000"))
    write("variants/opsentra-icon-white.svg", symbol_svg(MASTER, "#FFFFFF"))
    write("variants/opsentra-icon-small.svg", symbol_svg(SMALL, C["signal_deep"], "Opsentra symbol (small-size cut)"))
    write("variants/opsentra-wordmark.svg",
          f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{bounds[0]:.2f} {bounds[1]:.2f} {bounds[2]-bounds[0]:.2f} '
          f'{bounds[3]-bounds[1]:.2f}" role="img" aria-labelledby="title"><title id="title">Opsentra</title>'
          f'<path fill="{C["navy"]}" d="{d}"/></svg>\n')
    write("variants/opsentra-app-icon.svg",
          symbol_svg(SMALL, C["signal"], "Opsentra app icon", bg=C["navy"], rx=56, inner_scale=0.64))
    write("variants/favicon-static.svg", symbol_svg(SMALL, C["signal_deep"], "Opsentra"))
    print(f"lockup {L['W']} x {L['H']}  symbol h {L['sym_h']:.1f}  x-height {L['xh']:.1f}")
