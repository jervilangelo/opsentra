"""Phase 10: check a built dashboard bundle before it is published (read-only).

Usage: python scripts/release/check_bundle.py apps/dashboard/dist [--base /opsentra/]

Fails (exit 1) if the bundle:
  * contains anything that looks like an AWS account ID, access key, private
    key, JWT, GitHub token or client secret;
  * lacks the Content Security Policy, or allows scripts beyond 'self' and hashes;
  * does not default to Demo Mode;
  * references assets outside the expected base path;
  * has no 404.html SPA fallback (GitHub Pages deep links).
The public VITE_* values (API URL, user pool ID, client ID, Cognito domain) are
allowed by design (blueprint §9.3); they must not contain an account ID.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SECRETS = {
    "aws-account-id": re.compile(r"(?<![0-9A-Za-z.\-_/#])\d{12}(?![0-9A-Za-z.\-_])"),
    "aws-access-key": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "github-token": re.compile(r"\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}"),
    "client-secret": re.compile(r"(?i)client[_-]?secret\s*[:=]\s*['\"][^'\"]{8,}"),
}
ALLOWED = {"111122223333"}  # documentation placeholder only


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    dist = Path(sys.argv[1])
    base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "/"
    problems: list[str] = []

    files = [p for p in dist.rglob("*") if p.is_file() and p.suffix in {".html", ".js", ".css", ".json", ".webmanifest", ".map"}]
    if not files:
        problems.append(f"no built files in {dist}")
    for f in files:
        text = f.read_text("utf-8", errors="replace")
        for rule, rx in SECRETS.items():
            for m in rx.finditer(text):
                if m.group(0) not in ALLOWED:
                    problems.append(f"{f.relative_to(dist)}: {rule}")
                    break
        if f.suffix == ".map":
            problems.append(f"{f.relative_to(dist)}: source map would be published")

    index = dist / "index.html"
    html = index.read_text("utf-8") if index.exists() else ""
    csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    if not csp:
        problems.append("index.html: no Content-Security-Policy")
    else:
        scripts = re.search(r"script-src ([^;]+)", csp.group(1))
        tokens = scripts.group(1).split() if scripts else []
        if not tokens or any(t != "'self'" and not re.fullmatch(r"'sha256-[A-Za-z0-9+/=]+'", t) for t in tokens):
            problems.append("CSP: script-src allows more than 'self' and hashes")
        if "object-src 'none'" not in csp.group(1):
            problems.append("CSP: object-src is not 'none'")
    for ref in re.findall(r'(?:src|href)="(/[^"]*)"', html):
        if not ref.startswith(base):
            problems.append(f"index.html: asset outside base {base}: {ref}")
    if not (dist / "404.html").exists():
        problems.append("404.html SPA fallback missing")

    bundle = "".join(p.read_text("utf-8", errors="replace") for p in dist.rglob("*.js"))
    mode = re.search(r'VITE_APP_MODE_DEFAULT:"([a-z]*)"', bundle)
    if mode and mode.group(1) != "demo":
        problems.append(f"default mode is {mode.group(1)!r}, not 'demo'")

    for p in problems:
        print("BAD", p)
    print(f"bundle check: {len(files)} files, {'OK' if not problems else f'{len(problems)} problem(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
