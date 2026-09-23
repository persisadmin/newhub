#!/usr/bin/env python3
"""
PERSIS — JKR Jadual Kadar Kerja (JKH) PDF parser.

Parses JKR schedule-of-rates PDF books (e.g. JADUAL KADAR KERJA ELEKTRIK 2023)
into a JSON file ready for `scripts/import-benchmarks.ts`.

Usage:
    pip install pdfplumber
    python3 scripts/parse_jkh_pdf.py "JADUAL KADAR KERJA ELEKTRIK 2023.pdf" > jkh-elektrik-2023.json

Output JSON: { "sourceRef": ..., "items": [ { itemNo, description, unit, price, section, group } ] }
"""
import json
import re
import sys
from collections import Counter

UNITS = ["satu", "meter", "set", "loop", "hari", "Lot", "lot"]
ITEM_START = re.compile(r"^(\d{1,4})\s+(.+)$")
END_PAT = re.compile(r"^(.*?)\s+(" + "|".join(UNITS) + r")\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s*$", re.I)
SECTION_PAT = re.compile(r"^BAHAGIAN\s+([IVX]+)\s*[-–]?\s*(.*)$")
GROUP_PAT = re.compile(r"^([A-Z])\s+(.+)$")
SKIP_PAGES_DEFAULT = 22  # front matter (cover, TOC, panduan penggunaan)


def parse(path: str, skip_pages: int):
    import pdfplumber

    records = []
    section = None
    group = None
    pending = None  # [itemNo, [desc parts]]

    def flush():
        nonlocal pending
        if pending:
            no, parts = pending
            desc = " ".join(parts).strip()
            m = END_PAT.match(desc)
            if m:
                records.append({
                    "itemNo": no,
                    "description": m.group(1).strip(),
                    "unit": m.group(2),
                    "price": float(m.group(3).replace(",", "")),
                    "section": section,
                    "group": group,
                })
            pending = None

    skipped = 0
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages):
            if pi < skip_pages:
                continue
            text = page.extract_text() or ""
            for raw in text.split("\n"):
                line = raw.strip()
                if not line or "...." in line:
                    continue
                if line.startswith("BIL KETERANGAN") or line.startswith("HARGA 20"):
                    continue
                if re.fullmatch(r"\d{1,3}", line):  # page number
                    continue
                sm = SECTION_PAT.match(line)
                if sm and "KETERANGAN" not in line:
                    flush()
                    section = f"BAHAGIAN {sm.group(1)} - {sm.group(2).strip()}".strip(" -")
                    group = None
                    continue
                gm = GROUP_PAT.match(line)
                im = ITEM_START.match(line)
                if gm and not im:
                    flush()
                    group = gm.group(2).strip()
                    continue
                if im:
                    flush()
                    pending = [im.group(1), [im.group(2)]]
                    if END_PAT.match(im.group(2)):
                        flush()
                    continue
                if pending:
                    pending[1].append(line)
                    if END_PAT.match(" ".join(pending[1])):
                        flush()
                else:
                    if len(line) < 90 and not END_PAT.match(line):
                        group = line.strip()
                    else:
                        skipped += 1
    flush()
    return records, skipped


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    skip = int(sys.argv[2]) if len(sys.argv) > 2 else SKIP_PAGES_DEFAULT
    records, skipped = parse(path, skip)
    out = {
        "sourceRef": path.split("/")[-1].rsplit(".", 1)[0],
        "itemCount": len(records),
        "items": records,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print(f"\n# parsed {len(records)} items, {skipped} lines skipped", file=sys.stderr)
    secs = Counter(r["section"] for r in records)
    for s, c in secs.items():
        print(f"#   {c:5d}  {s}", file=sys.stderr)


if __name__ == "__main__":
    main()
