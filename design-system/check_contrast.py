#!/usr/bin/env python3
"""WCAG contrast check for tokens.css (stdlib only). Exit 0 when every pair passes, 1 otherwise.

    python3 -I check_contrast.py [tokens.css]

Resolves each semantic role to its primitive hex in both themes (dark is :root, light is
[data-theme="light"] layered over it), then checks every text role against the surfaces text sits on,
and every filled badge against its own text colour. AA for normal text is 4.5:1.
"""
import re
import sys

TEXT_ROLES = ["--fg-emph", "--fg-body", "--fg-meta", "--interactive", "--ok", "--warn", "--err"]
SURFACES = ["--surface-canvas", "--surface-card", "--surface-raised"]
FILLS = [("--on-warn-fill", "--warn-fill"), ("--on-err-fill", "--err-fill"), ("--primary-foreground", "--primary")]
AA = 4.5


def block(text, selector):
    start = text.index(selector)
    body_start = text.index("{", start) + 1
    return text[body_start:text.index("\n}", body_start)]


def declarations(css):
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", css))


def resolve(name, values, seen=()):
    value = values[name].strip()
    ref = re.fullmatch(r"var\((--[\w-]+)\)", value)
    if ref:
        if ref.group(1) in seen:
            raise ValueError("cycle at " + name)
        return resolve(ref.group(1), values, seen + (name,))
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError("%s is not a solid colour: %s" % (name, value))
    return value


def luminance(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def ratio(a, b):
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "tokens.css"
    text = open(path, encoding="utf-8").read()
    dark = declarations(block(text, ":root"))
    light = {**dark, **declarations(block(text, '[data-theme="light"]'))}
    checked = failed = 0
    for theme, values in (("dark", dark), ("light", light)):
        pairs = [(fg, bg) for fg in TEXT_ROLES for bg in SURFACES] + FILLS
        for fg, bg in pairs:
            r = ratio(resolve(fg, values), resolve(bg, values))
            checked += 1
            if r < AA:
                failed += 1
            print("%-6s %-20s on %-18s %5.2f %s" % (theme, fg, bg, r, "ok" if r >= AA else "FAIL"))
    print("%d pair(s) checked, %d below %.1f:1" % (checked, failed, AA))
    sys.exit(1 if failed or not checked else 0)


if __name__ == "__main__":
    main()
