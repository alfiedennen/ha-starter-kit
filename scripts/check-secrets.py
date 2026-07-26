#!/usr/bin/env python3
"""Secret scanner — stops credentials reaching git.

Zero dependencies. Two modes:

  python scripts/check-secrets.py          # scan the STAGED diff (pre-commit)
  python scripts/check-secrets.py --all    # scan the whole working tree

Wire it as a pre-commit hook once per clone:

  mkdir -p .githooks
  printf '#!/bin/sh\nexec python scripts/check-secrets.py\n' > .githooks/pre-commit
  chmod +x .githooks/pre-commit
  git config core.hooksPath .githooks

Exit codes: 0 clean, 1 at least one match (offenders printed).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

# Tuned for low false positives / reasonable recall.
PATTERNS = {
    "AWS_ACCESS_KEY":   re.compile(r"AKIA[0-9A-Z]{16}"),
    "AWS_SECRET":       re.compile(r"aws_secret_access_key\s*[=:]\s*[\"']?([A-Za-z0-9/+=]{40})[\"']?", re.IGNORECASE),
    "ANTHROPIC_KEY":    re.compile(r"sk-ant-(?:api\d{2}|admin\d{2})-[A-Za-z0-9_-]{80,}"),
    "OPENAI_KEY":       re.compile(r"sk-[A-Za-z0-9]{48,}"),
    "GITHUB_TOKEN":     re.compile(r"gh[pousr]_[A-Za-z0-9_]{36,}"),
    "GOOGLE_API_KEY":   re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    "GOOGLE_OAUTH":     re.compile(r"[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com"),
    "TELEGRAM_BOT":     re.compile(r"\d{8,12}:AA[A-Za-z0-9_-]{33}"),
    "PRIVATE_KEY_PEM":  re.compile(r"-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
    "SLACK_TOKEN":      re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    "HA_LONG_TOKEN":    re.compile(r"ey[A-Za-z0-9_-]{20,}\.ey[A-Za-z0-9_-]{100,}\.[A-Za-z0-9_-]{40,}"),
    "GENERIC_PASSWORD": re.compile(r"(password|passwd|secret)\s*[=:]\s*[\"'][^\"'\s]{8,}[\"']", re.IGNORECASE),
}

SKIP_PARTS = ("node_modules", ".git")
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz",
                 ".tar", ".db", ".sqlite", ".woff", ".woff2", ".ttf", ".bin")
SKIP_NAMES = ("check-secrets.py",)

# GENERIC_PASSWORD is noisy in docs that *show* placeholder passwords — allow
# it in markdown / example files only.
GENERIC_PASSWORD_OK_PATH = re.compile(
    r"\.md$|\.rst$|\.txt$|README|example|sample", re.IGNORECASE)


def _staged_files() -> list[str]:
    out = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        text=True)
    return [f for f in out.splitlines() if f.strip()]


def _tree_files() -> list[str]:
    out = subprocess.check_output(["git", "ls-files", "--cached", "--others",
                                   "--exclude-standard"], text=True)
    return [f for f in out.splitlines() if f.strip()]


def _skippable(path: str) -> bool:
    p = Path(path)
    if any(part in SKIP_PARTS for part in p.parts):
        return True
    if p.suffix.lower() in SKIP_SUFFIXES:
        return True
    return p.name in SKIP_NAMES


def scan(files: list[str]) -> int:
    hits = 0
    for path in files:
        if _skippable(path):
            continue
        try:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
        except (OSError, ValueError):
            continue
        for name, pattern in PATTERNS.items():
            if name == "GENERIC_PASSWORD" and GENERIC_PASSWORD_OK_PATH.search(path):
                continue
            for m in pattern.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                print(f"BLOCKED  {path}:{line_no}  [{name}]")
                hits += 1
    return hits


def main() -> int:
    files = _tree_files() if "--all" in sys.argv else _staged_files()
    if not files:
        return 0
    hits = scan(files)
    if hits:
        print(f"\n{hits} potential secret(s) found. Commit aborted.")
        print("If a match is a false positive, adjust PATTERNS or the skip lists.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
