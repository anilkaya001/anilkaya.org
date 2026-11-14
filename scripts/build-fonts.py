import sys, os, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out, keep_opsz = sys.argv[1], sys.argv[2], sys.argv[3] == "opsz"
FEATS = ["kern", "mark", "mkmk", "ccmp", "locl", "liga", "calt", "tnum", "pnum", "lnum", "case", "zero", "frac", "numr", "dnom", "sups", "subs", "sinf", "ordn"]

def rng(a, b):
    return set(range(a, b + 1))

LATIN = (rng(0x20, 0x7E) | rng(0xA0, 0xFF) | rng(0x100, 0x17F) | {0x18F, 0x192, 0x1A0, 0x1A1, 0x1AF, 0x1B0} | rng(0x218, 0x21B) | {0x237, 0x259}
         | {0x2BB, 0x2BC, 0x2C6, 0x2C7, 0x2D8, 0x2D9, 0x2DA, 0x2DB, 0x2DC, 0x2DD}
         | rng(0x300, 0x30C) | {0x326, 0x327, 0x328, 0x329}
         | rng(0x2000, 0x206F) | rng(0x2070, 0x209F) | {0x20AC, 0x20BA, 0x2113, 0x2116, 0x2122, 0x2126}
         | rng(0x2190, 0x2199) | rng(0x2200, 0x22FF) | rng(0x25A0, 0x25FF) | {0x2713, 0x2715, 0xFEFF, 0xFFFD})
GREEK = rng(0x370, 0x3FF)

def ranges(cps):
    cps = sorted(cps)
    res, s, p = [], cps[0], cps[0]
    for c in cps[1:]:
        if c != p + 1:
            res.append((s, p)); s = c
        p = c
    res.append((s, p))
    return ", ".join("U+%04X" % a if a == b else "U+%04X-%04X" % (a, b) for a, b in res)

for style, name in (("", "GoogleSans[GRAD,opsz,wght].ttf"), ("-italic", "GoogleSans-Italic[GRAD,opsz,wght].ttf")):
    for label, want in (("latin", LATIN), ("greek", GREEK)):
        f = TTFont(os.path.join(src, name))
        limits = {"GRAD": 0}
        if not keep_opsz:
            limits["opsz"] = 18
        gsub = f["GSUB"].table
        others = {li for fr in gsub.FeatureList.FeatureRecord if fr.FeatureTag != "tnum" for li in fr.Feature.LookupListIndex}
        for fr in gsub.FeatureList.FeatureRecord:
            if fr.FeatureTag == "tnum":
                for li in fr.Feature.LookupListIndex:
                    assert li not in others
                    for st in gsub.LookupList.Lookup[li].SubTable:
                        st = getattr(st, "ExtSubTable", st)
                        for k in ("space", "period", "comma", "colon", "semicolon"):
                            st.mapping.pop(k, None)
        have = set(f.getBestCmap())
        cps = sorted(want & have)
        o = subset.Options()
        o.layout_features = FEATS
        o.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        o.name_languages = [0x409]
        o.notdef_outline = True
        o.drop_tables += ["DSIG", "meta"]
        o.hinting = True
        o.desubroutinize = True
        s = subset.Subsetter(o)
        s.populate(unicodes=cps)
        s.subset(f)
        b = io.BytesIO(); f.save(b); b.seek(0); f = TTFont(b)
        f = instancer.instantiateVariableFont(f, limits)
        path = os.path.join(out, "GoogleSans%s-%s.woff2" % (style, label))
        f.flavor = "woff2"
        f.save(path)
        g = TTFont(path)
        print(path, os.path.getsize(path), "cps", len(g.getBestCmap()), "glyphs", g["maxp"].numGlyphs, [(a.axisTag, a.minValue, a.maxValue) for a in g["fvar"].axes])
        print("  unicode-range:", ranges(g.getBestCmap().keys()))
