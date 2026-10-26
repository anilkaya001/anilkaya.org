import hashlib
import json
import platform
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import exchange_calendars as xc

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures-math-time.json"
FIRST = date(2015, 1, 1)
LAST = date(2031, 12, 31)
TRT_FIRST = date(2017, 1, 1)
NY = ZoneInfo("America/New_York")
TRT = ZoneInfo("Europe/Istanbul")


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def minutes_since_midnight(local, day):
    midnight = datetime(day.year, day.month, day.day, tzinfo=local.tzinfo)
    return int((local.astimezone(timezone.utc) - midnight.astimezone(timezone.utc)).total_seconds() // 60)


def main():
    cal = xc.get_calendar("XNYS", start="2014-12-01", end="2032-01-31")
    sessions = cal.sessions_in_range(FIRST.isoformat(), LAST.isoformat())
    session_days = {s.date() for s in sessions}
    holidays = []
    for d in days(FIRST, LAST):
        if d.weekday() < 5 and d not in session_days:
            holidays.append(d.isoformat())
    early = {}
    trt = {}
    for s in sessions:
        d = s.date()
        close = cal.closes.loc[s].tz_convert(NY)
        open_ = cal.opens.loc[s].tz_convert(NY)
        close_min = close.hour * 60 + close.minute
        if close_min != 960:
            early[d.isoformat()] = close_min
        if d < TRT_FIRST:
            continue
        o = open_.astimezone(TRT)
        c = close.astimezone(TRT)
        key = (bool(close.utcoffset() == timedelta(hours=-4)), close_min != 960)
        value = (minutes_since_midnight(o, d), minutes_since_midnight(c, d))
        if trt.setdefault(key, value) != value:
            raise SystemExit("the TRT session span is not a function of daylight time and early close on " + d.isoformat())
    spans = []
    for (daylight, short), (o, c) in sorted(trt.items()):
        spans.append({"usDaylightTime": daylight, "earlyClose": short, "openTrtMin": o, "closeTrtMin": c})
    dst = []
    for y in range(FIRST.year, LAST.year + 1):
        start = end = None
        for d in days(date(y, 1, 1), date(y, 12, 31)):
            noon = datetime(d.year, d.month, d.day, 12, tzinfo=NY)
            prev = noon - timedelta(days=1)
            if noon.utcoffset() != prev.utcoffset():
                if noon.utcoffset() > prev.utcoffset():
                    start = d.isoformat()
                else:
                    end = d.isoformat()
        dst.append({"year": y, "usDaylightFrom": start, "usStandardFrom": end})
    instants = []
    for row in dst:
        for edge in (row["usDaylightFrom"], row["usStandardFrom"]):
            y, m, dd = (int(x) for x in edge.split("-"))
            base = datetime(y, m, dd, 4, 0, tzinfo=timezone.utc)
            for k in range(-24, 25):
                t = base + timedelta(minutes=30 * k)
                e = t.astimezone(NY)
                instants.append([int(t.timestamp() * 1000), e.strftime("%Y-%m-%d"), int(e.utcoffset().total_seconds() // 60)])
    script = Path(__file__).read_bytes()
    doc = {
        "provenance": {
            "generator": "tests/gen-math-time-fixtures.py",
            "generatorSha256": hashlib.sha256(script).hexdigest(),
            "python": platform.python_version(),
            "exchangeCalendars": xc.__version__,
            "calendar": "XNYS",
            "from": FIRST.isoformat(),
            "to": LAST.isoformat(),
            "synthetic": True,
        },
        "sessionCount": len(session_days),
        "holidays": holidays,
        "early": early,
        "trtSpans": spans,
        "dst": dst,
        "instants": instants,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(len(session_days), "sessions", len(holidays), "weekday closures", len(early), "early closes", len(spans), "trt spans")


main()
