"""Build the reviewed KNL compensation foundation manifest from PHF.cocauluong.xlsx.

Read-only input. The generated JSON is a server-side seed/reconciliation source, not a
Production write. Uses only Python's standard library so Excel floating-point money is
normalized deterministically to integer VND.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
EMPLOYEE_CODE = re.compile(r"PHF\d+", re.I)
GRADE_CODE = re.compile(r"[A-Z0-9]+-B\d+")
OVERRIDES = {
    "PHF038": "NSGQ-B1",
    "PHF080": "NSGQ-B1",
    "PHF034": "CUNG-B3",
    "PHF005": "CUNG-B2",
    "PHF073": "CUNG-B1",
    "PHF035": "CUNG-B3",
    "PHF064": "CUNG-B2",
    "PHF010": "QLCT-B4",
    "PHF004": "QLCT-B3",
    "PHF032": "QLCT-B2",
}


def column_number(reference: str) -> int:
    number = 0
    for char in re.match(r"[A-Z]+", reference).group(0):
        number = number * 26 + ord(char) - 64
    return number


def integer_vnd(value: object) -> int:
    try:
        return round(float(value or 0))
    except (TypeError, ValueError):
        return 0


def workbook_rows(path: Path) -> list[tuple[str, dict[int, dict[int, object]]]]:
    with ZipFile(path) as archive:
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared = [
            "".join(node.text or "" for node in item.iter(f"{{{NS['m']}}}t"))
            for item in shared_root.findall("m:si", NS)
        ]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
        result = []
        for sheet in workbook.find("m:sheets", NS):
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]]
            xml_path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
            root = ET.fromstring(archive.read(xml_path))
            rows: dict[int, dict[int, object]] = {}
            for row in root.findall(".//m:sheetData/m:row", NS):
                values = {}
                for cell in row.findall("m:c", NS):
                    value_node = cell.find("m:v", NS)
                    inline = cell.find("m:is", NS)
                    cell_type = cell.attrib.get("t")
                    value = None
                    if cell_type == "s" and value_node is not None:
                        value = shared[int(value_node.text)]
                    elif cell_type == "inlineStr" and inline is not None:
                        value = "".join(node.text or "" for node in inline.iter(f"{{{NS['m']}}}t"))
                    elif value_node is not None:
                        value = value_node.text
                    values[column_number(cell.attrib["r"])] = value
                rows[int(row.attrib["r"])] = values
            result.append((sheet.attrib["name"], rows))
        return result


def build(path: Path) -> dict:
    sheets = workbook_rows(path)
    if [name for name, _ in sheets] != ["Bảng Lương T07.2026", "ngachbacluong"]:
        raise ValueError("Workbook must contain the two reviewed sheets in the expected order")
    employee_rows, standard_rows = sheets[0][1], sheets[1][1]

    ladders = []
    for row_number, row in standard_rows.items():
        codes = [
            (column, str(value or "").strip().upper())
            for column, value in row.items()
            if column >= 6 and GRADE_CODE.fullmatch(str(value or "").strip().upper())
        ]
        if not codes:
            continue
        ladder_code = codes[0][1].split("-B", 1)[0]
        grades = []
        for column, grade_code in codes:
            if not grade_code.startswith(ladder_code + "-B"):
                continue
            grades.append(
                {
                    "gradeCode": grade_code,
                    "gradeNumber": int(grade_code.rsplit("B", 1)[1]),
                    "baseSalary": integer_vnd(standard_rows.get(row_number + 4, {}).get(column)),
                    "hqcv": integer_vnd(standard_rows.get(row_number + 5, {}).get(column)),
                    "managementAllowance": integer_vnd(standard_rows.get(row_number + 7, {}).get(column)),
                    "professionalAllowance": integer_vnd(standard_rows.get(row_number + 8, {}).get(column)),
                }
            )
        ladders.append(
            {
                "code": ladder_code,
                "name": str(row.get(2) or "").strip(),
                "sourceRow": row_number,
                "grades": grades,
            }
        )

    valid_grades = {grade["gradeCode"] for ladder in ladders for grade in ladder["grades"]}
    employees = []
    for row_number, row in employee_rows.items():
        employee_code = str(row.get(3) or "").strip().upper()
        if not EMPLOYEE_CODE.fullmatch(employee_code):
            continue
        source_grade = str(row.get(6) or "").strip().upper()
        mapped_grade = OVERRIDES.get(employee_code, source_grade)
        probation = source_grade == "TV"
        employees.append(
            {
                "sourceRow": row_number,
                "employeeCode": employee_code,
                "employeeName": str(row.get(4) or "").strip(),
                "sourceGradeCode": source_grade,
                "mappedGradeCode": None if probation else mapped_grade,
                "employmentType": "PROBATION" if probation else "OFFICIAL",
                "probationAmount": integer_vnd(row.get(9)) if probation else 0,
                "hasProfessionalAllowance": bool(str(row.get(7) or "").strip()) if not probation else False,
                "hasManagementAllowance": bool(str(row.get(8) or "").strip()) if not probation else False,
                "hasMealAllowance": integer_vnd(row.get(13)) > 0 if not probation else False,
                "mealAllowance": integer_vnd(row.get(13)) if not probation else 0,
                "mappingValid": probation or mapped_grade in valid_grades,
            }
        )

    if len(ladders) != 8 or sum(len(item["grades"]) for item in ladders) != 88:
        raise ValueError("Reviewed standard table must contain 8 ladders and 88 grades")
    if len(employees) != 40:
        raise ValueError("Reviewed T07.2026 source must contain 40 employee rows")
    probation_codes = {item["employeeCode"] for item in employees if item["employmentType"] == "PROBATION"}
    if probation_codes != {"PHF091", "PHF092"}:
        raise ValueError("Only PHF091 and PHF092 may be probation seed candidates")
    if any(not item["mappingValid"] for item in employees):
        raise ValueError("At least one employee mapping references a missing grade")

    return {
        "manifestVersion": "PHF_KNL_COMPENSATION_FOUNDATION_2026_07_V1",
        "sourceFile": path.name,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sourcePeriod": "2026-07",
        "effectivePeriod": None,
        "policy": {
            "money": "Integer VND using round() over Excel numeric cells.",
            "identity": "employee_code only; names are cross-check evidence.",
            "organization": "Read-only current organization; never write source organization.",
            "assignment": "Preview first; only WILL_ASSIGN may be written after migration and explicit effective period confirmation.",
        },
        "overrides": [
            {
                "employeeCode": code,
                "sourceGradeCode": next(item["sourceGradeCode"] for item in employees if item["employeeCode"] == code),
                "mappedGradeCode": mapped,
            }
            for code, mapped in OVERRIDES.items()
        ],
        "ladders": ladders,
        "employees": employees,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    manifest = build(args.workbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "ladders": len(manifest["ladders"]),
                "grades": sum(len(item["grades"]) for item in manifest["ladders"]),
                "employees": len(manifest["employees"]),
                "overrides": len(manifest["overrides"]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
