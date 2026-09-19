"""
build_artifact.py — render the results page (HTML) from results/model_comparison.json.

The page's charts and tables are drawn client-side from the embedded JSON, so no result
number is typed by hand. The only hand-written parts are the lede and the findings, which
live in results/artifact_copy.json ({"lede": "...", "findings": [{"h": "...", "p": "..."}]}).

Run:  python experiments/build_artifact.py [output.html]
"""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RES = HERE / "results"

data = json.loads((RES / "model_comparison.json").read_text())
data["followup"] = json.loads((RES / "seed_check.json").read_text())
copy = json.loads((RES / "artifact_copy.json").read_text())

findings = "".join(
    f"<li><b>{html.escape(x['h'])}</b>{html.escape(x['p'])}</li>" for x in copy["findings"]
)
page = (HERE / "artifact_template.html").read_text()
page = page.replace("__LEDE__", html.escape(copy["lede"]))
page = page.replace("__FINDINGS__", findings)
page = page.replace("__DATA__", json.dumps(data))

out = Path(sys.argv[1]) if len(sys.argv) > 1 else RES / "report.html"
out.write_text(page)
print("wrote", out, f"({len(page) / 1024:.0f} KB)")
