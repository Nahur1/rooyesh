"""Post-processing for Rooyesh.xlsx.
  python postprocess.py prepare in.xlsx out.xlsx meta.json  → hidden helper columns, internal links, active sheet
  python postprocess.py rtl in.xlsx out.xlsx                → right-to-left sheet views (XML patch; keeps cached values)"""
import json
import re
import sys
import zipfile

mode = sys.argv[1]
if mode == "prepare":
    from openpyxl import load_workbook
    src, dst, meta_path = sys.argv[2:5]
    meta = json.load(open(meta_path, encoding="utf-8"))
    wb = load_workbook(src)
    for name, cols in meta["helpers"].items():
        for c in cols:
            wb[name].column_dimensions[c].hidden = True
    for item in meta["notes"]:
        ws = wb[item["sheet"]]
        r0, r1 = item["linkRows"]
        for i, r in enumerate(range(r0, r1 + 1)):
            ws.cell(row=r, column=2).hyperlink = f"#'{item['links'][i]}'!A1"
    wb.active = wb.sheetnames.index(meta["active"])
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == meta["active"]
        ws.sheet_view.zoomScale = 110
    wb.save(dst)
    print("prepared", dst)
elif mode == "rtl":
    src, dst = sys.argv[2:4]
    n = 0
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"xl/worksheets/sheet\d+\.xml$", item.filename):
                text = data.decode("utf-8")
                def add(m):
                    tag = m.group(0)
                    return tag if "rightToLeft=" in tag else tag.replace("<sheetView", '<sheetView rightToLeft="1"', 1)
                text, k = re.subn(r"<sheetView\b[^>]*>", add, text)
                n += k
                data = text.encode("utf-8")
            elif re.match(r"xl/tables/table\d+\.xml$", item.filename):
                data = data.decode("utf-8").replace('showRowStripes="1"', 'showRowStripes="0"').encode("utf-8")
            elif item.filename == "xl/styles.xml":
                text = data.decode("utf-8")
                text = re.sub(r'<name val="(?:Noto Sans|Calibri|Arial)"/>', '<name val="Tahoma"/>', text)
                text = re.sub(r'<scheme val="(?:minor|major)"/>', "", text)
                data = text.encode("utf-8")
            elif re.match(r"xl/charts/chart\d+\.xml$", item.filename) or item.filename.startswith("xl/theme/"):
                text = data.decode("utf-8")
                text = re.sub(r'(<a:(?:latin|cs)\b[^>]*typeface=")(?:Calibri|Arial|Cambria|Noto Sans)(")', r"\1Tahoma\2", text)
                text = re.sub(r'(<a:font script="Arab" typeface=")[^"]*(")', r"\1Tahoma\2", text)
                if "/charts/" in item.filename:
                    text = re.sub(r"<c:legend>.*?</c:legend>", "", text, flags=re.S)  # single series → no legend
                    text = text.replace('sz="1800"', 'sz="1200"')
                data = text.encode("utf-8")
            zout.writestr(item, data)
    print("rtl views:", n)
