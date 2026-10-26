import hashlib
import json
import sys

import exchange_calendars as xc
import pandas as pd

HERE = __file__
FIRST = "2020-01-01"
LAST = "2027-12-31"
cal = xc.get_calendar("XNYS", start="2019-06-01", end="2028-12-31")
days = pd.date_range(FIRST, LAST, freq="D")
iso = lambda d: d.strftime("%Y-%m-%d")
sessions = [iso(d) for d in cal.sessions_in_range(FIRST, LAST)]
session_set = set(sessions)
holidays = [iso(d) for d in days if d.weekday() < 5 and iso(d) not in session_set]
early = []
for d in cal.early_closes:
    if FIRST <= iso(d) <= LAST:
        close = cal.session_close(d).tz_convert("America/New_York")
        early.append({"d": iso(d), "close": close.strftime("%H:%M")})

nxt = lambda d: iso(cal.date_to_session(pd.Timestamp(d), direction="next"))
after = lambda d: iso(cal.next_session(pd.Timestamp(d))) if d in session_set else nxt(d)

report_dates = sorted(set(
    ["2025-11-26", "2025-11-27", "2025-11-28", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-06",
     "2026-03-02", "2026-03-06", "2026-03-07", "2026-03-08", "2026-02-13", "2026-02-14", "2026-02-16", "2026-02-17",
     "2026-12-24", "2026-12-25", "2026-12-28", "2026-12-31", "2027-01-01", "2027-01-04", "2026-06-18", "2026-06-19",
     "2026-06-22", "2026-07-02", "2026-07-03", "2026-07-06", "2026-09-04", "2026-09-07", "2026-09-08", "2027-11-24",
     "2027-11-25", "2027-11-26", "2027-12-23", "2027-12-24", "2027-12-27", "2024-03-28", "2024-03-29", "2024-04-01"]
))
impact = []
for d in report_dates:
    is_session = d in session_set
    impact.append({
        "date": d,
        "session": is_session,
        "before-open": d if is_session else nxt(d),
        "after-close": after(d),
        "unknown": [d if is_session else nxt(d), after(d)] if is_session else [nxt(d)],
    })

pairs = []
probe = sorted(set(report_dates + ["2026-08-24", "2026-08-21", "2026-10-26", "2026-11-25", "2026-11-27", "2026-12-18", "2027-06-30", "2027-07-02", "2027-12-31", "2024-01-01"]))
for a in probe:
    for b in probe:
        if a > b:
            continue
        sa = cal.sessions_in_range(pd.Timestamp(a) + pd.Timedelta(days=1), pd.Timestamp(b)) if a < b else []
        pairs.append({"from": a, "to": b, "n": len(sa)})

offsets = []
for d in ["2026-08-24", "2026-08-21", "2026-11-25", "2026-04-02", "2026-12-23", "2027-12-20", "2026-02-13", "2027-06-29"]:
    ts = pd.Timestamp(d)
    if d not in session_set:
        continue
    for n in (1, 2, 5, 19, 20, 21, 60):
        offsets.append({"day": d, "n": n, "to": iso(cal.session_offset(ts, n))})
        offsets.append({"day": d, "n": -n, "to": iso(cal.session_offset(ts, -n))})

index_probe = [sessions[0], sessions[1], sessions[250], sessions[-1], "2026-08-24", "2026-11-27"]
indexes = [{"day": d, "index": sessions.index(d)} for d in index_probe]

prov = {
    "generator": "tests/gen-calendar-fixtures.py",
    "calendar": "XNYS",
    "exchange_calendars": xc.__version__,
    "pandas": pd.__version__,
    "first": FIRST,
    "last": LAST,
    "sessions": len(sessions),
    "sessionsSha256": hashlib.sha256("\n".join(sessions).encode()).hexdigest(),
    "script_sha256": hashlib.sha256(open(HERE, "rb").read()).hexdigest(),
    "nature": "Exchange calendar facts for the New York Stock Exchange read from the exchange_calendars package; no vendor data.",
}
out = {"provenance": prov, "holidays": holidays, "earlyCloses": early, "impact": impact, "distance": pairs, "offset": offsets, "index": indexes}
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "fixtures-calendar.json", "w"), separators=(",", ":"))
print(len(sessions), len(holidays), len(early), len(impact), len(pairs), len(offsets))
