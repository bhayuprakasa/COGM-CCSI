#!/usr/bin/env python3
"""
Import Excel BOM (DUCT Cable 12F/2T MMF) ke cogm.json
Usage: python3 scripts/import_excel_duct12f.py <path_to_excel>

Script ini membaca kertas kerja Excel dan mengisi:
  - items       : master bahan baku
  - dlfoh       : rate DL/FOH per mesin
  - exrates     : kurs valuta
  - masterbom   : struktur BOM lengkap dengan group, lines, dlfohLines
Lalu tulis ke data/cogm.json. Jalankan node scripts/migrate.js untuk push ke MySQL.
"""
import sys, json, os, re
from datetime import datetime
import openpyxl

# ── Helpers ──────────────────────────────────────────────────────────────────
def now_str():
    return datetime.now().strftime("%d/%m/%Y %H.%M.%S")

def uid(prefix=""):
    import random, time
    return prefix + hex(int(time.time()*1000))[2:] + hex(random.randint(0,0xfffff))[2:]

def num(v, default=0.0):
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default

def safe(v, default=""):
    if v is None:
        return default
    return str(v).strip()

XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else None
if not XLSX_PATH:
    print("Usage: python3 scripts/import_excel_duct12f.py <path_to_excel>")
    sys.exit(1)

COGM_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "cogm.json")

# ── Load workbook ─────────────────────────────────────────────────────────────
print(f"\n📂 Membaca file: {XLSX_PATH}")
wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
sheets = wb.sheetnames
print(f"   Sheet ditemukan: {', '.join(sheets)}")

# ── Load existing cogm.json ───────────────────────────────────────────────────
with open(COGM_JSON, "r", encoding="utf-8") as f:
    cogm = json.load(f)

# Helper: list existing codes to avoid duplicates
existing_items  = {x["code"] for x in cogm.get("items", [])}
existing_dlfoh  = {x["catid"] for x in cogm.get("dlfoh", [])}
existing_mbom   = {x["product"] for x in cogm.get("masterbom", [])}
existing_exrate = {x["currency_id"] for x in cogm.get("exrates", [])}

# ── 1. Parse DL-FOH sheet ────────────────────────────────────────────────────
print("\n📋 Parsing sheet DL-FOH...")
ws_dlfoh = wb["DL-FOH"]
new_dlfoh = []
for row in ws_dlfoh.iter_rows(min_row=2, values_only=True):
    # Kolom: Resource(A), Description(B), Type(C), Rate(D)
    catid, desc, rtype, rate = row[0], row[1], row[2], row[3]
    if not catid or not desc:
        continue
    catid = safe(catid)
    if catid in existing_dlfoh:
        print(f"   ⚠️  Skip (sudah ada): {catid}")
        continue
    new_dlfoh.append({
        "id":          uid("DF"),
        "catid":       catid,
        "desc":        safe(desc),
        "type":        safe(rtype, "Machine"),
        "rate":        num(rate),
        "created_by":  "import",
        "created_dt":  now_str(),
        "modified_by": "import",
        "modified_dt": now_str(),
    })
    existing_dlfoh.add(catid)
print(f"   ✅ {len(new_dlfoh)} DL-FOH baru")

# ── 2. Parse Price List → items ───────────────────────────────────────────────
print("\n📋 Parsing sheet Price List → items...")
ws_price = wb["Price List"]
# Kolom E=RMCode, F=Concatenate(nama lengkap), G=Currency, H=UnitPrice, I=Hedging, J=Landed
# Baris 1-3 adalah header
new_items = []
# Buat mapping item_code → { currency, price, hedging, landed }
item_price_map = {}  # code -> list of price variants

for row in ws_price.iter_rows(min_row=4, values_only=True):
    code = safe(row[4] if len(row)>4 else None)
    concat_name = safe(row[5] if len(row)>5 else None)
    currency = safe(row[6] if len(row)>6 else "USD")
    price = num(row[7] if len(row)>7 else 0)
    hedging = num(row[8] if len(row)>8 else 0)
    landed = num(row[9] if len(row)>9 else 0)

    if not code or not concat_name or code.startswith("#"):
        continue

    # Ambil UoM dari nama concatenate (format: ... - UoM - Currency - Mode)
    uom = "pcs"
    parts = [p.strip() for p in concat_name.split(" - ")]
    # UoM biasanya ada di posisi ke-3 dari belakang sebelum currency
    if len(parts) >= 4:
        uom = parts[-3] if parts[-3].lower() not in ("usd","eur","idr","cny") else "pcs"
    # Ambil nama singkat (bagian sebelum " - ")
    short_name = parts[0] if parts else concat_name

    if code not in existing_items:
        new_items.append({
            "id":          uid("ITM"),
            "code":        code,
            "name":        short_name,
            "uom":         uom,
            "created_by":  "import",
            "created_dt":  now_str(),
            "modified_by": "import",
            "modified_dt": now_str(),
        })
        existing_items.add(code)

    # Simpan harga (ambil yang pertama per kode)
    if code not in item_price_map:
        item_price_map[code] = {
            "currency": currency,
            "price":    price,
            "hedging":  hedging,
            "landed":   landed,
            "name":     concat_name,
        }

print(f"   ✅ {len(new_items)} items baru")

# ── 3. Parse DUCT 12F → exchange rates + masterbom ──────────────────────────
print("\n📋 Parsing sheet DUCT 12F...")
ws_duct = wb["DUCT 12F"]

# Baca semua baris sebagai dict row_no → values
all_rows = {}
for i, row in enumerate(ws_duct.iter_rows(values_only=True), 1):
    all_rows[i] = row

def cell(row_no, col_letter):
    """Ambil nilai sel berdasarkan baris dan kolom (A=0, B=1, ...)"""
    col_idx = ord(col_letter.upper()) - ord('A')
    r = all_rows.get(row_no, [])
    return r[col_idx] if col_idx < len(r) else None

# --- 3a. Exchange rates (dari baris 2-6, kolom K=rate IDR, L=factor)
print("   Parsing exchange rates...")
# Baris 2: USD, Baris 3: EUR, Baris 4: IDR, Baris 5: CNY
exrate_map = {
    safe(cell(2, 'K')): num(cell(2, 'L')),   # USD
    safe(cell(3, 'K')): num(cell(3, 'L')),   # EUR
    safe(cell(5, 'K')): num(cell(5, 'L')),   # CNY
}
# Juga ambil nilai IDR rate (K=1, L=5.5e-05)
exrate_map["IDR"] = 1.0

new_exrates = []
for curr, rate_idr in exrate_map.items():
    if not curr or curr in existing_exrate:
        continue
    # Rate dalam IDR per 1 unit mata uang
    rate_in_idr = num(all_rows[2][10]) if curr == "USD" else \
                  num(all_rows[3][10]) if curr == "EUR" else \
                  num(all_rows[5][10]) if curr == "CNY" else 1.0

    new_exrates.append({
        "id":          uid("EX"),
        "currency_id": curr,
        "created_dt":  now_str(),
        "updated_dt":  now_str(),
        "lines": [{
            "tanggal":          "10/11/2026",
            "rate":             rate_in_idr,
            "rate_conversion":  rate_idr,
        }]
    })
    existing_exrate.add(curr)
print(f"   ✅ {len(new_exrates)} exchange rates baru")

# --- 3b. Header BOM
product_name = safe(cell(3, 'C'))  # Row 3, Col C = "DUCT Cable  12F/2T MMF"
buffer_qty   = safe(cell(8, 'C'))  # Row 8, Col C = 2 (Loose Tube Qty)
fiber_qty    = safe(cell(9, 'C'))  # Row 9, Col C = 6 (Fiber/Tube)
print(f"   Produk: {product_name} | Buffer: {buffer_qty} | Fiber/tube: {fiber_qty}")

if product_name in existing_mbom:
    print(f"   ⚠️  Master BOM '{product_name}' sudah ada, skip.")
    new_masterbom = []
else:
    def parse_group(group_name, header_row, mat_rows):
        """
        Parse satu machine line group dari Excel.
        header_row: nomor baris header (berisi speed, dl_lot, foh_lot, kap_pct di kolom Q-T)
        mat_rows:   list nomor baris material
        Returns dict group sesuai schema masterbom_groups
        """
        r = all_rows.get(header_row, [])
        # Layout kolom pada baris header group (0=A, 1=B, ...):
        # Q(16)=nama group (duplikat), R(17)=speed mpm, S(18)=DL lot, T(19)=FOH lot, U(20)=kap_pct
        speed    = num(r[17] if len(r)>17 else 0, 1)
        dl_lot   = num(r[18] if len(r)>18 else 1, 1)
        foh_lot  = num(r[19] if len(r)>19 else 1, 1)
        kap_pct  = num(r[20] if len(r)>20 else 100)
        # kap_pct dari Excel sudah dalam desimal (0.75 = 75%), kalikan 100
        if 0 < kap_pct <= 1:
            kap_pct = round(kap_pct * 100, 2)

        lines = []
        dlfoh_lines = []
        dlfoh_idx = 0  # DL/FOH hanya ada di 3 baris pertama tiap group

        for rno in mat_rows:
            r = all_rows.get(rno, [])
            # Kolom: B(1)=mat_name, C(2)=mat_code, D(3)=uom
            # E(4)=nothing, F(5)=scrap, G(6)=qty, H(7)=factor, I(8)=total_qty
            mat_name = safe(r[1] if len(r)>1 else None)
            mat_code = safe(r[2] if len(r)>2 else None)
            uom      = safe(r[3] if len(r)>3 else "pcs")
            scrap    = num(r[5] if len(r)>5 else 0)
            qty      = num(r[6] if len(r)>6 else 0)
            factor   = num(r[7] if len(r)>7 else 1, 1)
            total_qty= num(r[8] if len(r)>8 else 0)

            # Tambah material jika ada nama dan kode
            if mat_name and mat_code and not mat_name.startswith("CM -"):
                mat_name = mat_name.strip()
                lines.append({
                    "item_code":  mat_code,
                    "item_name":  mat_name,
                    "uom":        uom,
                    "qty":        qty,
                    "scrap":      scrap,
                    "factor":     factor,
                    "total_qty":  total_qty,
                })
                # Auto-add ke items jika belum ada
                if mat_code not in existing_items:
                    new_items.append({
                        "id":          uid("ITM"),
                        "code":        mat_code,
                        "name":        mat_name,
                        "uom":         uom,
                        "created_by":  "import",
                        "created_dt":  now_str(),
                        "modified_by": "import",
                        "modified_dt": now_str(),
                    })
                    existing_items.add(mat_code)

            # DL/FOH lines - kolom Q(16)=type, R(17)=cat, U(20)=idx, V(21)=factor, W(22)=setup, X(23)=total_hour
            dl_type = safe(r[16] if len(r)>16 else None)
            dl_cat  = safe(r[17] if len(r)>17 else None)
            if dl_cat and dlfoh_idx < 3 and dl_type in ("Direct Labor","Fixed FOH","Variable FOH"):
                idx        = num(r[20] if len(r)>20 else 0)
                dl_factor  = num(r[21] if len(r)>21 else 1, 1)
                setup      = num(r[22] if len(r)>22 else 0)
                total_hour = num(r[23] if len(r)>23 else 0)
                total_cost = num(r[24] if len(r)>24 else 0)
                dlfoh_lines.append({
                    "cat":          dl_cat,
                    "type":         dl_type,
                    "idx":          idx,
                    "index_manual": 0,
                    "factor":       dl_factor,
                    "setup":        setup,
                    "total_hour":   total_hour,
                    "total_cost":   total_cost,
                })
                dlfoh_idx += 1

        return {
            "machine_line": group_name,
            "machine_id":   "",
            "kap_id":       "",
            "speed":        speed,
            "kapPct":       kap_pct,
            "dlLot":        dl_lot,
            "fohLot":       foh_lot,
            "lines":        lines,
            "dlfohLines":   dlfoh_lines,
        }

    # Fiber group (Row 13, sebelum COLOURING)
    fiber_group = {
        "machine_line": "FIBER",
        "machine_id":   "",
        "kap_id":       "",
        "speed":        0,
        "kapPct":       100,
        "dlLot":        1,
        "fohLot":       1,
        "lines": [{
            "item_code":  safe(all_rows[13][2]),
            "item_name":  safe(all_rows[13][1]).strip(),
            "uom":        safe(all_rows[13][3]),
            "qty":        num(all_rows[13][6]),
            "scrap":      num(all_rows[13][5]),
            "factor":     num(all_rows[13][7], 1),
            "total_qty":  num(all_rows[13][8]),
        }],
        "dlfohLines": [],
    }

    groups = [
        fiber_group,
        parse_group("COLOURING",           18, list(range(19, 31))),
        parse_group("BUFFERING [Tube 1.9]", 35, list(range(36, 48))),
        parse_group("STRANDING [6el]",     50, list(range(51, 59))),
        parse_group("JACKETING",           63, list(range(64, 70))),
    ]

    bomid  = "MBOM-0001"
    new_masterbom = [{
        "id":          "MBOMDOC-" + bomid,
        "bomid":       bomid,
        "product":     product_name,
        "customer":    "",
        "project":     "",
        "fiber_cnt":   safe(all_rows[13][2]),
        "buffer_qty":  buffer_qty,
        "fiber_qty":   fiber_qty,
        "created_by":  "import",
        "created_dt":  now_str(),
        "modified_by": "import",
        "modified_dt": now_str(),
        "groups":      groups,
    }]
    print(f"   ✅ Master BOM '{product_name}' berhasil diparse")
    for g in groups:
        mat_cnt   = len(g["lines"])
        dlfoh_cnt = len(g["dlfohLines"])
        print(f"      Group '{g['machine_line']}': {mat_cnt} materials, {dlfoh_cnt} DL/FOH")

# ── 4. Merge ke cogm.json ─────────────────────────────────────────────────────
cogm.setdefault("items",     []).extend(new_items)
cogm.setdefault("dlfoh",     []).extend(new_dlfoh)
cogm.setdefault("exrates",   []).extend(new_exrates)
cogm.setdefault("masterbom", []).extend(new_masterbom)

with open(COGM_JSON, "w", encoding="utf-8") as f:
    json.dump(cogm, f, ensure_ascii=False, indent=2, default=str)

print(f"\n✅ cogm.json diperbarui:")
print(f"   items      : +{len(new_items)}")
print(f"   dlfoh      : +{len(new_dlfoh)}")
print(f"   exrates    : +{len(new_exrates)}")
print(f"   masterbom  : +{len(new_masterbom)}")
print(f"\nLangkah berikutnya:")
print(f"  node scripts/migrate.js   ← push ke MySQL")
