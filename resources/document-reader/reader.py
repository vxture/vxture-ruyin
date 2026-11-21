"""Fixed, offline source reader. Input bytes on stdin; bounded JSON lines on stdout."""
import hashlib
import io
import json
import sys
from importlib.metadata import version
from pathlib import Path

# Libraries are installed at build time with a hash-locked requirements file.
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import pdfplumber
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

ENGINE = {"adapter": "1.0.1", "pdfplumber": version("pdfplumber"), "python-docx": version("python-docx"),
          "script-sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          "requirements-sha256": hashlib.sha256(Path(__file__).with_name("requirements.lock").read_bytes()).hexdigest()}
MAX_INPUT = 20 * 1024 * 1024
MAX_OUTPUT = 12 * 1024 * 1024
emitted = 0


def emit(value):
    global emitted
    line = json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n"
    size = len(line.encode("utf-8"))
    emitted += size
    if size > 1024 * 1024 or emitted > MAX_OUTPUT:
        raise ValueError("Reading output exceeds the supported size; no complete snapshot was produced")
    print(line, end="", flush=True)


def bounds(box):
    return [round(n, 2) for n in box]


def read_pdf(raw):
    with pdfplumber.open(io.BytesIO(raw)) as doc:
        if getattr(doc.doc, "encryption", None) is not None:
            raise ValueError("Encrypted PDFs are not supported")
        if len(doc.pages) > 500:
            raise ValueError("PDF exceeds 500 pages")
        emit({"kind": "start", "engine": ENGINE, "total": len(doc.pages)})
        for n, page in enumerate(doc.pages, 1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            tables = []
            for table in page.find_tables():
                rows = table.extract(x_tolerance=2, y_tolerance=3)
                if not rows or max(map(len, rows), default=0) < 2:
                    continue
                tables.append({"bbox": bounds(table.bbox), "rows": rows,
                               "cells": [[None if cell is None else bounds(cell) for cell in row.cells] for row in table.rows]})
            flags = []
            if len("".join(text.split())) < 80:
                flags.append("sparse-text-needs-review")
            if page.images:
                flags.append("images-not-transcribed")
            if tables:
                flags.append("table-boundaries-need-review")
            if any(len(t["rows"]) == 1 for t in tables):
                flags.append("single-row-table")
            if "\ufffd" in text or "(cid:" in text:
                flags.append("unmapped-characters")
            emit({"kind": "unit", "unit": {"index": n - 1, "location": {"page": n, "width": page.width, "height": page.height},
                  "markdown": "## PDF page " + str(n) + "\n\n" + text, "text": text, "tables": tables,
                  "lines": [{"text": line["text"], "bbox": bounds([line[k] for k in ["x0", "top", "x1", "bottom"]])}
                            for line in page.extract_text_lines(x_tolerance=2, y_tolerance=3, return_chars=False)],
                  "images": [bounds([image[k] for k in ["x0", "top", "x1", "bottom"]]) for image in page.images], "flags": flags}})


def office_block(item, location):
    if isinstance(item, Paragraph):
        style = item.style.name if item.style else ""
        level = int(style[8:]) if style.startswith("Heading ") and style[8:].isdigit() else 0
        return {"markdown": ("#" * min(level, 6) + " " if level else "") + item.text,
                "text": item.text, "style": style, "location": {"block": location}}
    anchors, rows, cells = {}, [], []
    for ri, row in enumerate(item.rows, 1):
        values, positions = [None] * row.grid_cols_before, [None] * row.grid_cols_before
        for ci, cell in enumerate(row.cells, row.grid_cols_before + 1):
            position = location + "/row-" + str(ri) + "/column-" + str(ci)
            anchor = anchors.setdefault(cell._tc, position)
            values.append(cell.text if anchor == position else None)
            positions.append({"position": position, "anchor": anchor})
        rows.append(values)
        cells.append(positions)
    # Markdown is a readable transcription; raw grid and merge anchors stay separate.
    escape = lambda value: (value or "").replace("&", "&amp;").replace("|", "&#124;").replace("\n", "&#10;")
    width = max(map(len, rows), default=0)
    if not width:
        return {"markdown": "", "text": "", "location": {"block": location}}
    grid = ["| " + " | ".join(escape(v) for v in row) + " |" for row in rows]
    grid.insert(1, "| " + " | ".join(["---"] * width) + " |")
    return {"markdown": "\n".join(grid), "text": "\n".join("\t".join(v or "" for v in row) for row in rows),
            "location": {"block": location}, "tables": [{"rows": rows, "cells": cells}], "flags": ["merged-table-grid-needs-review"]}


def read_docx(raw):
    # Reject compressed bombs before handing the archive to the library.
    import zipfile
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if len(archive.infolist()) > 10000 or sum(i.file_size for i in archive.infolist()) > 80 * 1024 * 1024:
            raise ValueError("DOCX expanded size exceeds limits")
    doc = Document(io.BytesIO(raw))
    flags = ["word-pagination-unavailable", "automatic-numbering-not-rendered"]
    variants = ["header", "footer", "first_page_header", "first_page_footer", "even_page_header", "even_page_footer"]
    stories = [doc.element] + [getattr(s, name)._element for s in doc.sections for name in variants]
    for xpath, flag in [(".//w:drawing | .//w:pict", "images-not-transcribed"), (".//w:ins | .//w:del", "tracked-changes-need-review"),
                        (".//w:txbxContent", "text-boxes-need-review"), (".//w:fldChar | .//w:instrText", "fields-not-evaluated"),
                        (".//w:footnoteReference | .//w:endnoteReference", "notes-need-review")]:
        if any(story.xpath(xpath) for story in stories):
            flags.append(flag)
    blocks = [(item, "body/" + str(i)) for i, item in enumerate(doc.iter_inner_content(), 1)]
    for n, section in enumerate(doc.sections, 1):
        for name in variants:
            story = getattr(section, name)
            blocks.extend((item, "section-" + str(n) + "/" + name + "/" + str(i))
                          for i, item in enumerate(story.iter_inner_content(), 1) if isinstance(item, Table) or item.text)
    if doc.element.xpath(".//w:tc/w:tbl"):
        flags.append("nested-tables-need-review")
    if len(blocks) > 5000:
        raise ValueError("DOCX exceeds 5000 body blocks")
    emit({"kind": "start", "engine": ENGINE, "total": len(blocks), "flags": flags})
    for index, (item, location) in enumerate(blocks):
        unit = office_block(item, location)
        unit.update({"index": index, "flags": unit.get("flags", []), "tables": unit.get("tables", []), "images": []})
        emit({"kind": "unit", "unit": unit})


def read_markdown(raw):
    text = raw.decode("utf-8-sig", errors="strict")
    lines = text.splitlines(keepends=True)
    chunks, start, part = [], 1, ""
    for n, line in enumerate(lines, 1):
        if part and len(part) + len(line) > 6000:
            chunks.append((start, n - 1, part))
            start, part = n, ""
        part += line
    if part or not chunks:
        chunks.append((start, len(lines), part))
    if len(chunks) > 5000:
        raise ValueError("Markdown exceeds 5000 blocks")
    emit({"kind": "start", "engine": ENGINE, "total": len(chunks)})
    for index, (start, end, content) in enumerate(chunks):
        emit({"kind": "unit", "unit": {"index": index, "markdown": content, "text": content,
              "location": {"lineStart": start, "lineEnd": end}, "tables": [], "images": [], "flags": []}})


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--check"]:
            print(json.dumps(ENGINE))
        else:
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                raise ValueError("Input exceeds 20 MiB")
            {"pdf": read_pdf, "docx": read_docx, "md": read_markdown}[sys.argv[1]](raw)
            emit({"kind": "done", "sha256": hashlib.sha256(raw).hexdigest()})
    except Exception as error:
        print(json.dumps({"kind": "error", "error": type(error).__name__ + ": " + str(error)[:300]}), flush=True)
        raise SystemExit(1)
