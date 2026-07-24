#!/usr/bin/env python3
"""Remove rules from lab.css whose selectors are all dead classes.

Rules:
  * A selector is dead if it references a dead class as a whole class token.
  * :not(...) / :is(...) / :where(...) contents are IGNORED when deciding — a
    selector like `.lab-hero > p:not(.lab-hero__kicker)` styles LIVE paragraphs
    and must be kept even though it names a dead class.
  * Grouped rules keep their live selectors; only dead ones are dropped.
  * A rule whose every selector is dead is removed entirely.
  * @media / @supports bodies are processed recursively; a block left empty is
    removed too.
"""
import re
import sys

DEAD = {
    "academy-cockpit", "academy-dashboard", "dashboard-command-grid", "dashboard-overall",
    "dashboard-resume__progress", "lab-hero__actions", "lab-hero__browse", "lab-hero__kicker",
    "lab-hero__meta", "lab-hero__note", "lab-hero__proof", "lesson-head__meta", "lesson-progress",
}
FUNCTIONAL = re.compile(r":(?:not|is|where|has)\([^()]*\)")


def selector_is_dead(sel: str) -> bool:
    """True if the selector can never match, i.e. it names a dead class outside
    a functional pseudo-class."""
    probe = sel
    # Strip functional pseudo-class contents (repeatedly, for nesting).
    for _ in range(4):
        new = FUNCTIONAL.sub(":x", probe)
        if new == probe:
            break
        probe = new
    names = set(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", probe))
    return bool(names & DEAD)


def split_top(css: str):
    """Yield (kind, text) chunks: ('at', full_at_rule) | ('rule', full_rule) | ('other', text)."""
    i, n, out = 0, len(css), []
    buf = ""
    while i < n:
        ch = css[i]
        if ch == "/" and css.startswith("/*", i):
            end = css.find("*/", i + 2)
            end = n if end == -1 else end + 2
            buf += css[i:end]
            i = end
            continue
        if ch == "{":
            # find matching close
            depth, j = 1, i + 1
            while j < n and depth:
                if css.startswith("/*", j):
                    k = css.find("*/", j + 2)
                    j = n if k == -1 else k + 2
                    continue
                if css[j] == "{":
                    depth += 1
                elif css[j] == "}":
                    depth -= 1
                j += 1
            prelude, body = buf, css[i + 1: j - 1]
            out.append(("at" if prelude.lstrip().startswith("@") else "rule", prelude, body, css[i:j]))
            buf = ""
            i = j
            continue
        buf += ch
        i += 1
    if buf.strip():
        out.append(("other", buf, "", buf))
    return out


def process(css: str, stats: dict) -> str:
    pieces = split_top(css)
    result = []
    for kind, prelude, body, _raw in pieces:
        if kind == "other":
            result.append(prelude)
            continue
        if kind == "at":
            at_name = prelude.lstrip().split()[0].lower()
            if at_name in ("@media", "@supports"):
                inner = process(body, stats)
                if inner.strip():
                    # Keep the block's closing brace where it was: appending it to
                    # the last surviving rule would produce "...; }}".
                    tail = "\n" if "\n" in inner.rstrip() else ""
                    result.append(prelude + "{" + inner.rstrip() + tail + "}")
                else:
                    stats["blocks_removed"] += 1
                    stats["bytes"] += len(prelude) + len(body) + 2
                    # keep any leading comment/newlines that belonged to prelude
                continue
            result.append(prelude + "{" + body + "}")
            continue
        # plain rule: prelude may carry leading comments/whitespace
        m = re.match(r"^(\s*(?:/\*.*?\*/\s*)*)(.*)$", prelude, re.S)
        lead, sel_text = m.group(1), m.group(2)
        selectors = [s.strip() for s in sel_text.split(",") if s.strip()]
        live = [s for s in selectors if not selector_is_dead(s)]
        if not live:
            stats["rules_removed"] += 1
            stats["bytes"] += len(sel_text) + len(body) + 2
            stats["removed_selectors"].extend(selectors)
            # Keep a comment that documented the area; drop a whitespace-only lead
            # so removal does not leave blank lines and trailing spaces behind.
            result.append(lead if "/*" in lead else "")
            continue
        if len(live) == len(selectors):
            # Untouched: re-emit byte-for-byte so the diff stays surgical instead
            # of reformatting every rule in the file.
            result.append(prelude + "{" + body + "}")
            continue
        stats["selectors_trimmed"] += len(selectors) - len(live)
        stats["removed_selectors"].extend([s for s in selectors if s not in live])
        # Only grouped rules that actually lost a selector get rebuilt. Mirror the
        # original one-selector-per-line style of the file.
        result.append(lead + ",\n".join(live) + " {" + body + "}")
    return "".join(result)


def main() -> int:
    path = "/home/user/anilkaya.org/assets/css/lab.css"
    css = open(path, encoding="utf-8").read()
    stats = {"rules_removed": 0, "selectors_trimmed": 0, "blocks_removed": 0, "bytes": 0, "removed_selectors": []}
    out = process(css, stats)
    # tidy: collapse runs of blank lines left behind
    out = re.sub(r"[ \t]+(?=\n)", "", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    print(f"rules removed      : {stats['rules_removed']}")
    print(f"selectors trimmed  : {stats['selectors_trimmed']} (grouped rules kept)")
    print(f"empty @blocks gone : {stats['blocks_removed']}")
    print(f"before / after     : {len(css):,} -> {len(out):,} bytes ({len(css)-len(out):,} saved)")
    if "--write" in sys.argv:
        open(path, "w", encoding="utf-8").write(out)
        print("WROTE", path)
    else:
        open("/tmp/claude-0/-home-user-anilkaya-org/4de51319-f116-51bd-a52e-e6bbd8e518f0/scratchpad/lab.pruned.css", "w", encoding="utf-8").write(out)
        print("dry run -> scratchpad/lab.pruned.css")
        print("\nsample of dropped selectors:")
        for s in stats["removed_selectors"][:14]:
            print("   ", s.replace("\n", " ")[:88])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
