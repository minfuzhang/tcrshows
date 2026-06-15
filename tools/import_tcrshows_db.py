from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl


FIELDS = [
    "id",
    "hla",
    "peptide",
    "pos",
    "antigen",
    "cdr3a",
    "cdr3b",
    "trav",
    "traj",
    "trbv",
    "trbj",
    "functionalValidation",
    "aka",
    "reference",
    "year",
]


def load_existing_payload(output_path: Path) -> dict:
    if not output_path.exists():
      return {"articles": [], "services": []}

    text = output_path.read_text(encoding="utf-8").strip()
    prefix = "window.TCRSHOWS_DEFAULT_DATA = "
    if text.startswith(prefix):
        text = text[len(prefix) :]
    if text.endswith(";"):
        text = text[:-1]
    return json.loads(text)


def convert_excel(excel_path: Path) -> tuple[list[str], list[dict]]:
    workbook = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    headers = [str(value).strip() for value in rows[0]]
    data = []

    for row in rows[1:]:
        item = {}
        for field, value in zip(FIELDS, row):
            item[field] = "" if value is None else str(value).strip()
        data.append(item)

    return headers, data


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python tools/import_tcrshows_db.py <TCRshows-db.xlsx>")
        return 2

    excel_path = Path(sys.argv[1])
    output_path = Path("data/site-data.js")
    headers, rows = convert_excel(excel_path)
    payload = load_existing_payload(output_path)
    payload["dbColumns"] = headers
    payload["dbRows"] = rows

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "window.TCRSHOWS_DEFAULT_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Imported {len(rows)} rows into {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
