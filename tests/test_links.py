"""Every relative import/link under src/ and landing/ must point at a file that exists."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_REF = re.compile(r"""(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}/[^"']+)["']""")
HTML_REF = re.compile(r"""(?:src|href)=["'](\.{1,2}/[^"'#?]+)["']""")


def refs():
    for path in [*ROOT.glob("src/**/*.js"), *ROOT.glob("src/**/*.html"), *ROOT.glob("landing/*.html")]:
        pattern = JS_REF if path.suffix == ".js" else HTML_REF
        for ref in pattern.findall(path.read_text(encoding="utf-8")):
            yield path, ref


def test_relative_references_resolve():
    missing = [
        f"{p.relative_to(ROOT)} -> {ref}"
        for p, ref in refs()
        if not (p.parent / ref).resolve().exists()
    ]
    assert not missing, "\n".join(missing)


def test_absolute_src_links_resolve():
    link = re.compile(r"""href=["'](/src/[^"'#?]+)["']""")
    missing = [
        f"{p.relative_to(ROOT)} -> {ref}"
        for p in ROOT.glob("src/**/*.html")
        for ref in link.findall(p.read_text(encoding="utf-8"))
        if not (ROOT / ref.lstrip("/")).exists()
    ]
    assert not missing, "\n".join(missing)
