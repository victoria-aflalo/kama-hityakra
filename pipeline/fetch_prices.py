#!/usr/bin/env python3
"""
כמה התייקרה המכולת שלך - daily price collection pipeline.

Pulls the full price files (PriceFull) that Israeli supermarket chains publish
under the price transparency law (חוק שקיפות המחירים), extracts the curated
basket (pipeline/basket.json), stores a dated snapshot in data/, and rebuilds
docs/data/index.json which the static site consumes.

Stores tracked (fixed, so the index is comparable day over day):
  shufersal  - שופרסל ONLINE (store 413)
  rami_levy  - רמי לוי תלפיות (store 1; their online file updates rarely)
  carrefour  - קרפור אונליין (store 471)

Usage:
  python pipeline/fetch_prices.py                 # scrape live (CI)
  python pipeline/fetch_prices.py --offline-dir D # parse existing XMLs in D
"""
import argparse
import asyncio
import datetime as dt
import glob
import json
import os
import sys
import xml.etree.ElementTree as ET

CHAINS = {
    "shufersal": {"scraper": "SHUFERSAL", "store_id": 413, "name_he": "שופרסל", "store_he": "שופרסל ONLINE"},
    "rami_levy": {"scraper": "RAMI_LEVY", "store_id": 1, "name_he": "רמי לוי", "store_he": "רמי לוי תלפיות"},
    "carrefour": {"scraper": "YAYNO_BITAN_AND_CARREFOUR", "store_id": 471, "name_he": "Carrefour", "store_he": "קרפור אונליין"},
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
DOCS_DATA = os.path.join(ROOT, "docs", "data")
BASKET_PATH = os.path.join(ROOT, "pipeline", "basket.json")


def load_xml(path):
    items = {}
    for i in ET.parse(path).getroot().iter("Item"):
        code = (i.findtext("ItemCode") or "").strip()
        price = (i.findtext("ItemPrice") or "").strip()
        name = (i.findtext("ItemName") or "").strip()
        try:
            items[code] = (name, float(price))
        except ValueError:
            continue
    return items


async def scrape_chain(chain_key, cfg, workdir):
    from il_supermarket_scarper.scrappers_factory import ScraperFactory
    from il_supermarket_scarper.utils.file_types import FileTypesFilters
    from il_supermarket_scarper.utils.file_output import DiskFileOutput

    cls = ScraperFactory.get(cfg["scraper"])
    inst = cls(file_output=DiskFileOutput(storage_path=os.path.join(workdir, chain_key)))
    async for entry in inst.scrape(limit=1, store_id=cfg["store_id"],
                                   files_types=[FileTypesFilters.PRICE_FULL_FILE.name]):
        print(chain_key, "->", entry.file_name, entry.downloaded, entry.error)


def newest_xml(folder):
    files = sorted(glob.glob(os.path.join(folder, "**", "*Price*.xml"), recursive=True) +
                   glob.glob(os.path.join(folder, "*Price*.xml")))
    return files[-1] if files else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline-dir", help="folder with pre-downloaded PriceFull XMLs named <chain>_*.xml or <chain>/...")
    args = ap.parse_args()

    today = dt.date.today().isoformat()
    workdir = os.path.join(ROOT, ".work")

    if args.offline_dir:
        xml_paths = {k: newest_xml(os.path.join(args.offline_dir, k)) for k in CHAINS}
    else:
        os.makedirs(workdir, exist_ok=True)
        for k, cfg in CHAINS.items():
            asyncio.run(scrape_chain(k, cfg, workdir))
        xml_paths = {k: newest_xml(os.path.join(workdir, k)) for k in CHAINS}

    missing = [k for k, p in xml_paths.items() if not p]
    if missing:
        print("missing price files for:", missing, file=sys.stderr)
        sys.exit(1)

    basket = json.load(open(BASKET_PATH))
    chain_items = {k: load_xml(p) for k, p in xml_paths.items()}

    snapshot_items, totals = [], {k: 0.0 for k in CHAINS}
    for it in basket["items"]:
        bc = it["barcode"]
        prices = {k: round(v[bc][1], 2) for k, v in chain_items.items() if bc in v}
        if len(prices) < 2:
            print(f"skip {it['id']}: found in {list(prices)} only")
            continue
        snapshot_items.append({"id": it["id"], "name_he": it["name_he"], "category": it["category"],
                               "barcode": bc, "prices": prices})
        for k, p in prices.items():
            totals[k] += p

    snapshot = {
        "date": today,
        "items": snapshot_items,
        "totals": {k: round(v, 2) for k, v in totals.items()},
        "chains": {k: {"name_he": c["name_he"], "store_he": c["store_he"], "source_file": os.path.basename(xml_paths[k])}
                   for k, c in CHAINS.items()},
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(DOCS_DATA, exist_ok=True)
    out = os.path.join(DATA_DIR, f"prices-{today}.json")
    json.dump(snapshot, open(out, "w"), ensure_ascii=False, indent=1)
    print("wrote", out, f"({len(snapshot_items)} items)")

    # rebuild index.json from all snapshots
    snapshots = []
    for f in sorted(glob.glob(os.path.join(DATA_DIR, "prices-*.json"))):
        s = json.load(open(f))
        snapshots.append({"date": s["date"], "totals": s["totals"]})
        json.dump(s, open(os.path.join(DOCS_DATA, os.path.basename(f)), "w"), ensure_ascii=False)
    json.dump({"generated_at": dt.datetime.now().isoformat(timespec="seconds"),
               "chains": snapshot["chains"],
               "basket": basket["items"],
               "snapshots": snapshots,
               "latest": snapshot},
              open(os.path.join(DOCS_DATA, "index.json"), "w"), ensure_ascii=False)
    json.dump(basket, open(os.path.join(DOCS_DATA, "basket.json"), "w"), ensure_ascii=False, indent=1)
    print("rebuilt docs/data/index.json with", len(snapshots), "snapshots")
    print("totals:", snapshot["totals"])


if __name__ == "__main__":
    main()
