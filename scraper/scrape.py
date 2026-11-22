"""Collect upcoming BanG Dream! lives/events from the official site into data.json.

Polite by design: one run per day, ~1.5 s between requests, list pages until past
events only, detail pages only for new events / events without prices (others weekly).
On any fetch or parse problem the previous data.json is kept unchanged.
"""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://bang-dream.com/events/"
UA = "bandori-live-schedule/1.0 (+personal fan schedule page; daily, low rate)"
OUT = Path(__file__).resolve().parent.parent / "data.json"
JST = dt.timezone(dt.timedelta(hours=9))
DELAY = 1.5
MAX_LIST_PAGES = 4


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    time.sleep(DELAY)
    return body


def text(fragment):
    s = re.sub(r"<br\s*/?>", "\n", fragment)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"[ \t　]+", " ", s).strip()


DATE_TOKEN = re.compile(r"(?:(\d{4})年)?\s*(?:(\d{1,2})月)?\s*(\d{1,2})日")


def parse_dates(s, year_hint):
    """'2027年4月4日(日)・4月10日(土)' -> [date, ...]; '9月19日(土)～10月4日(日)' -> range (start, end)."""
    s = re.sub(r"\([^)]*\)|（[^）]*）", "", s)          # drop weekday parts
    is_range = bool(re.search(r"[～~〜]", s))
    y, m = year_hint, None
    out = []
    for tok in re.split(r"[・、,，～~〜]", s):
        g = DATE_TOKEN.search(tok)
        if not g:
            continue
        if g.group(1):
            y = int(g.group(1))
        if g.group(2):
            m = int(g.group(2))
        if m is None:
            continue
        try:
            out.append(dt.date(y, m, int(g.group(3))))
        except ValueError:
            continue
    return out, is_range


def parse_list(page_html):
    events = []
    for art in re.findall(r'<article class="p-live-event-list__item">(.*?)</article>', page_html, re.S):
        href = re.search(r'href="([^"]+)"', art)
        title = re.search(r'item-title">(.*?)</div>', art, re.S)
        cat = re.search(r'item-category"><span>(.*?)</span>', art, re.S)
        if not (href and title):
            continue
        desc = re.search(r'item-description">(.*?)</div>', art, re.S)
        fields = {}
        if desc:
            for h, p in re.findall(r"<h2[^>]*>(.*?)</h2>\s*<p>(.*?)</p>", desc.group(1), re.S):
                fields[text(h)] = text(p)
        bands = [text(b) for b in re.findall(r'artist-item">(.*?)</span>', art, re.S)]
        events.append({
            "url": href.group(1),
            "title": text(title.group(1)),
            "category": text(cat.group(1)) if cat else "",
            "date_text": fields.get("開催日", ""),
            "venue_text": fields.get("場所", ""),
            "summary": fields.get("概要", ""),
            "bands": [b for b in bands if b],
        })
    return events


def parse_prices(detail_html):
    """Lines right after the '料金' heading that carry a currency."""
    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", detail_html, flags=re.S)
    lines = [l.strip() for l in text(re.sub(r"</(p|li|div|h\d|dd|dt|tr)>", "\n", body)).split("\n")]
    lines = [re.sub(r"\s+", " ", l) for l in lines if l.strip()]
    cur = re.compile(r"[0-9][0-9,]*\s*円|HK\$|₩|KRW|NT\$|US\$|\$\s?\d|원")
    prices = []
    for i, l in enumerate(lines):
        if l in ("料金", "チケット料金", "料金（税込）", "チケット代金"):
            for nxt in lines[i + 1:i + 30]:
                if not cur.search(nxt) or len(nxt) > 120:
                    if prices:
                        break
                    continue
                seat, _, price = re.split(r"([：:])", nxt, maxsplit=1) if re.search(r"[：:]", nxt) else ("", "", nxt)
                price = re.sub(r"\)\)$", ")", price.strip())     # official page typo "(税込))"
                prices.append([seat.strip(), price])
            break
    return prices[:12]


def kind_of(ev):
    t = ev["title"].upper()
    if ev["category"] == "イベント" or not ev["bands"]:
        return "이벤트"
    if "TOUR" in t or "ツアー" in t:
        return "투어"
    if "出演" in ev["summary"]:
        return "출연"
    if len(ev["bands"]) > 1:
        return "합동"
    return "단독"


def build_stops(ev, today):
    dates, is_range = parse_dates(ev["date_text"], today.year)
    venues = [v.strip() for v in re.split(r"[・、]", ev["venue_text"]) if v.strip()] if ev["venue_text"] else []
    stops, venue_note = [], ""
    if is_range and len(dates) >= 2:
        stops = [{"date": dates[0].isoformat(), "end": dates[-1].isoformat(), "venue": ev["venue_text"]}]
    elif len(venues) <= 1:
        stops = [{"date": d.isoformat(), "venue": ev["venue_text"]} for d in dates]
    elif len(venues) == len(dates):
        stops = [{"date": d.isoformat(), "venue": v} for d, v in zip(dates, venues)]
    else:
        stops = [{"date": d.isoformat(), "venue": ""} for d in dates]
        venue_note = ev["venue_text"]
    return stops, venues, venue_note


def main():
    now = dt.datetime.now(JST)
    today = now.date()
    old = {}
    if OUT.exists():
        try:
            old = {e["url"]: e for e in json.loads(OUT.read_text(encoding="utf-8")).get("events", [])}
        except Exception:
            old = {}

    collected = []
    for page in range(1, MAX_LIST_PAGES + 1):
        url = BASE if page == 1 else f"{BASE}page/{page}/"
        items = parse_list(fetch(url))
        if not items:
            break
        any_upcoming = False
        for ev in items:
            stops, venues, venue_note = build_stops(ev, today)
            if not stops:
                continue
            last = max(dt.date.fromisoformat(s.get("end", s["date"])) for s in stops)
            if last < today:
                continue
            any_upcoming = True
            collected.append({**ev, "kind": kind_of(ev), "stops": stops, "venues": venues, "venue_note": venue_note})
        if not any_upcoming:
            break

    if not collected:
        print("no upcoming events parsed; keeping previous data.json", file=sys.stderr)
        return 1

    weekly = today.weekday() == 0   # refresh known prices on Mondays
    for ev in collected:
        prev = old.get(ev["url"], {})
        if prev.get("prices") and not weekly:
            ev["prices"] = prev["prices"]
            continue
        try:
            ev["prices"] = parse_prices(fetch(ev["url"]))
        except Exception as e:
            print(f"detail fetch failed {ev['url']}: {e}", file=sys.stderr)
            ev["prices"] = prev.get("prices", [])

    collected.sort(key=lambda e: e["stops"][0]["date"])
    data = {"source": BASE, "events": collected}
    new_core = json.dumps(data, ensure_ascii=False, sort_keys=True)
    old_core = ""
    if OUT.exists():
        try:
            o = json.loads(OUT.read_text(encoding="utf-8"))
            o.pop("updated", None)
            old_core = json.dumps(o, ensure_ascii=False, sort_keys=True)
        except Exception:
            pass
    if new_core == old_core:
        print("no changes")
        return 0
    data["updated"] = now.strftime("%Y-%m-%d %H:%M JST")
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(collected)} events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
