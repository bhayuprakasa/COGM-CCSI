#!/usr/bin/env python3
"""
Import harga bahan baku dari sheet 'Price List' Excel ke:
  - data/price_import_1.json  (164 items, bagian 1)
  - data/price_import_2.json  (165 items, bagian 2)
  - data/cogm.json            (prices[] section)

Jalankan: python scripts/import_prices_duct12f.py <path_ke_xlsx>
Contoh  : python scripts/import_prices_duct12f.py data/DUCT_Cable_12F.xlsx
"""
import json, openpyxl, hashlib, sys, os

# Path xlsx: argumen CLI pertama, atau default ke data/ folder
BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE_DIR, 'data', '2026_11_10_DUCT_Cable_12F_MMF_PCM_Bu_Sherly.xlsx')
JSON_PATH = os.path.join(BASE_DIR, 'data', 'cogm.json')
NOW = '10/11/2026 00.00.00'

def gen_id(prefix, seed):
    h = hashlib.md5(seed.encode()).hexdigest()[:16]
    return f"{prefix}{h}"

wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
ws = wb['Price List']

lines = []
seen_codes = set()  # dedupe: pakai harga pertama per kode

for row in ws.iter_rows(min_row=4, values_only=True):
    code = row[4]       # col E: RMCODE
    if not code or not str(code).strip():
        continue
    code = str(code).strip()
    if code in ('No RMCode', 'RMCODE Baru', '#REF!'):
        continue
    if code in seen_codes:
        continue        # skip duplikat, ambil baris pertama

    name    = str(row[5]).strip() if row[5] else ''
    curr    = str(row[6]).strip() if row[6] else 'USD'
    price   = float(row[7]) if row[7] is not None else 0.0
    hedging = float(row[8]) if row[8] is not None else 0.0
    landed  = float(row[9]) if row[9] is not None else 0.0  # selisih landed

    seen_codes.add(code)
    lines.append({
        "id":          gen_id("PL", code + name),
        "item_code":   code,
        "item_name":   name,
        "qty":         1,
        "currency":    curr,
        "price":       round(price, 6),
        "hedging":     round(hedging, 6),
        "landed":      round(landed, 6),
        "modified_by": "import",
        "modified_dt": NOW
    })

print(f"Total price_lines: {len(lines)}")

# Split ke dua file untuk menghindari batasan ukuran GitHub
mid = len(lines) // 2
out1 = os.path.join(BASE_DIR, 'data', 'price_import_1.json')
out2 = os.path.join(BASE_DIR, 'data', 'price_import_2.json')
with open(out1, 'w') as f:
    json.dump(lines[:mid], f, ensure_ascii=False)
with open(out2, 'w') as f:
    json.dump(lines[mid:], f, ensure_ascii=False)
print(f"✅ {out1}: {mid} items")
print(f"✅ {out2}: {len(lines)-mid} items")

# Buat satu price header
price_id = gen_id("PRC", "Price List DUCT 12F 2026-11-10")
price_header = {
    "id":          price_id,
    "created_by":  "import",
    "created_dt":  NOW,
    "modified_by": "import",
    "modified_dt": NOW,
    "lines":       lines
}

# Update cogm.json
with open(JSON_PATH) as f:
    data = json.load(f)

data["prices"]      = [price_header]
data["price_lines"] = []  # migrate.js baca dari prices[].lines

with open(JSON_PATH, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"✅ cogm.json diupdate: 1 price header, {len(lines)} price_lines")
print(f"   Price ID: {price_id}")
