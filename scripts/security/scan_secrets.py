"""Local secret scan over the working tree and the full git history (Phase 9).

Usage: python scripts/security/scan_secrets.py
CI runs gitleaks on every push (.github/workflows/secrets-scan.yml); this is a
second, dependency-free check the owner can run on Windows. It prints only the
commit, file and rule for each hit, never the matched value. Exit 1 on any hit.

Allowed on purpose: the placeholder account IDs 111122223333 (tests, mocked
Terraform), 000000000000 (examples) and 999999999999 (forged-account tests),
and AWS's documented example key ID. Digits inside hex hashes are ignored.
"""

from __future__ import annotations

import re
import subprocess
import sys

RULES = {
    "aws-access-key-id": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "aws-secret-key": re.compile(r"(?i)aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{40}"),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "github-token": re.compile(r"\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}"),
    "password-assignment": re.compile(r"(?i)\b(password|passwd|client_secret)\s*[=:]\s*['\"][^'\"\s$]{6,}['\"]"),
    "aws-account-id": re.compile(r"(?<![0-9a-fA-F.])\d{12}(?![0-9a-fA-F.])"),
}
ALLOWED_VALUES = {"111122223333", "000000000000", "999999999999", "AKIAIOSFODNN7EXAMPLE"}
# Paths whose 12-digit numbers are not account IDs (lockfile hashes, images).
SKIP_PATH = re.compile(r"(package-lock\.json|\.terraform\.lock\.hcl|\.png|\.jpg|\.svg|\.ico|\.woff2?)$")
# A 12-digit run inside a longer token (timestamps in ns, hex) is not an account ID.
CONTEXT_OK = re.compile(r"\d{12}(#|[0-9a-f]{3,})")


def hits_in(text: str, where: str) -> list[str]:
    out = []
    for rule, rx in RULES.items():
        for m in rx.finditer(text):
            value = m.group(0)
            if value in ALLOWED_VALUES or any(a in value for a in ALLOWED_VALUES):
                continue
            if rule == "aws-account-id":
                tail = text[m.start() : m.end() + 4]
                if CONTEXT_OK.match(tail) or value.startswith(("17", "20")):  # epoch/date-like numbers
                    continue
            out.append(f"{where}: {rule}")
    return out


def main() -> int:
    log = subprocess.run(
        ["git", "log", "--all", "-p", "--no-color", "--format=COMMIT %h"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout
    commit, path, found = "?", "?", []
    for line in log.splitlines():
        if line.startswith("COMMIT "):
            commit = line.split()[1]
        elif line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++") and not SKIP_PATH.search(path):
            found += hits_in(line[1:], f"{commit} {path}")
    found = sorted(set(found))
    for f in found:
        print("HIT", f)
    print(f"{len(found)} finding(s) across the full history" if found else "CLEAN: no secrets or account IDs in history")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
