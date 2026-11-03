#!/usr/bin/env python3
"""WCAG contrast check for the generated tokens.css (stdlib only). Exit 0 when every pair passes, 1 otherwise.

    python3 -I design-system/check_contrast.py [packages/design-tokens/tokens.css]
    python3 -I design-system/check_contrast.py design-system/design-system-v3.html

Resolves each semantic role to its primitive hex in both themes (dark is :root, light is
[data-theme="light"] layered over it), then checks every text role against the surfaces text sits on,
and every filled badge against its own text colour. AA for normal text is 4.5:1.

A file that carries the Lime tokens (design-system-v3.html) is checked as Lime: light is the
[data-system="lime"], .lime block, dark is the dark block layered over light, and Errand's :where(.lime)
extension block is merged into both. A dark block after the verbatim source (Errand's fix for two dark
danger values) is layered over dark. Text pairs and filled pairs need 4.5:1, including the text on every
stop of the glow gradients (rest, lit and pressed, both ends). Non-text pairs (a control outline, a status
mark, a focus ring, the booked mark, the inferred edge) need 3:1 (WCAG 1.4.11).
"""
import re
import sys

TEXT_ROLES = ["--fg-emph", "--fg-body", "--fg-meta", "--interactive", "--ok", "--warn", "--err"]
SURFACES = ["--surface-canvas", "--surface-card", "--surface-raised"]
FILLS = [("--on-warn-fill", "--warn-fill"), ("--on-err-fill", "--err-fill"), ("--primary-foreground", "--primary")]
AA = 4.5
NON_TEXT = 3.0

LIME_LIGHT = '[data-system="lime"], .lime {'
LIME_DARK = '[data-system="lime"][data-theme="dark"]'
ERRAND_EXT = ":where(.lime) {"
LIME_END = "/* ---- end lime source"
LIME_TEXT = ["--fg", "--fg-2", "--fg-3", "--success-text", "--warn-text", "--danger-text"]
LIME_SURFACES = ["--page", "--surface", "--raised"]
LIME_FILLS = [
    ("--on-accent", "--accent"), ("--on-accent", "--accent-hover"), ("--on-accent", "--accent-active"),
    ("--fg", "--accent-wash"), ("--fg-inverse", "--ink"), ("--fg-inverse", "--ink-hover"), ("--fg-inverse", "--ink-active"),
    ("--on-danger", "--danger"), ("--on-danger", "--danger-hover"),
    ("--success-text", "--success-tint"), ("--warn-text", "--warn-tint"), ("--danger-text", "--danger-tint"),
    ("--fg", "--surface-2"), ("--fg-2", "--surface-2"), ("--fg-3", "--surface-2"), ("--fg", "--field"), ("--fg-3", "--field"),
]
GLOW_STOPS = ["from", "to", "from-lit", "to-lit", "from-press", "to-press"]
LIME_GLOW = [("--glow-accent-fg", "--glow-accent-" + s) for s in GLOW_STOPS] + [("--on-danger", "--glow-danger-" + s) for s in GLOW_STOPS]
LIME_NON_TEXT = [
    ("--control", "--page"), ("--control", "--surface"), ("--control", "--surface-2"),
    ("--accent-line", "--page"), ("--accent-line", "--surface"),
    ("--success", "--page"), ("--warn", "--page"), ("--danger", "--page"),
    ("--errand-on-ok-fill", "--errand-ok-fill"), ("--errand-ok-fill", "--page"), ("--errand-ok-fill", "--surface"),
    ("--errand-inferred-edge", "--page"), ("--errand-inferred-edge", "--surface"), ("--errand-inferred-edge", "--raised"),
]
DEFAULT_TOKENS = "packages/design-tokens/tokens.css"


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


def lime_themes(text):
    light = declarations(block(text, LIME_LIGHT))
    dark = {**light, **declarations(block(text, LIME_DARK))}
    rest = text[text.find(LIME_END):] if LIME_END in text else ""
    if LIME_DARK in rest:  # a dark override after the verbatim source wins, as it does in the browser
        dark.update(declarations(block(rest, LIME_DARK)))
    if ERRAND_EXT in text:
        ext = declarations(block(text, ERRAND_EXT))
        light, dark = {**light, **ext}, {**dark, **ext}
    return (("light", light), ("dark", dark))


def lime_main(text):
    checked = failed = 0
    for theme, values in lime_themes(text):
        groups = [([(fg, bg) for fg in LIME_TEXT for bg in LIME_SURFACES] + LIME_FILLS + LIME_GLOW, AA), (LIME_NON_TEXT, NON_TEXT)]
        for pairs, floor in groups:
            for fg, bg in pairs:
                r = ratio(resolve(fg, values), resolve(bg, values))
                checked += 1
                if r < floor:
                    failed += 1
                print("%-6s %-22s on %-22s %5.2f %s %.1f" % (theme, fg, bg, r, "ok  " if r >= floor else "FAIL", floor))
    print("%d pair(s) checked, %d below their floor (4.5:1 text, 3:1 non-text)" % (checked, failed))
    sys.exit(1 if failed or not checked else 0)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TOKENS
    text = open(path, encoding="utf-8").read()
    if LIME_LIGHT in text:
        lime_main(text)
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
