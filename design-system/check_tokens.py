#!/usr/bin/env python3
"""Design-token check (copied from Nainish-Rai/observatory-ui, MIT) (stdlib only). Exit 0 clean, 1 on findings.

    python3 -I design-system/check_tokens.py [--tokens tokens.css] [--lime] [file ...]

--tokens names the token file an app stylesheet builds on (repeatable). Its custom properties count as
defined in every checked file, as they do in the browser, and the token file itself is checked too.
With no arguments it checks the generated packages/design-tokens/tokens.css.

Vendored region: the primitive block (/* ---- primitives ... /* ---- semantic roles) in the app's tokens, or
the verbatim Lime source (/* ---- lime source ... /* ---- end lime source) in design-system-v3.html. Raw
values are allowed there and nowhere else; every --lime rule below also skips it.

Rules
  raw-color      a hex, rgb()/rgba() or hsl() colour outside the vendored region
  token-parity   a var(--x) that no custom property defines
  reduced-motion no prefers-reduced-motion block, or script animation without a `reduced` guard
  literal-duration a transition/animation with a fixed duration, which reduced motion cannot zero
                 (use a --dur-* token)

Lime rules (--lime, for pages built on the Lime system)
  weight-700     font-weight 700/bold/800/900, or a <b>/<strong> tag; Lime's heaviest weight is 600
  uppercase      text-transform: uppercase (Lime has no small capitals or eyebrows)
  letter-spacing letter-spacing other than var(--tracking-tight) or 0 (Lime never tracks out)
  gradient       a CSS gradient; the glow, inside the vendored region, is the only one
  curve          a cubic-bezier() or keyword easing in a declaration; use --ease-out or --ease-in
                 (the spinner's linear turn is the one exception, on the lime-spin line)
  loop           `infinite` anywhere but the lime-spin spinner, the only loop Lime allows
  scroll-reveal  IntersectionObserver (Lime does not play motion on scroll)
  transition-all transition: all
  shadow         a box-shadow that is not var(--shadow-*) or none
  font-size      a literal font-size; use --text-*
  radius         a literal border-radius other than 0 or 50%; use --radius-*
  dash-emoji     an em dash, en dash or emoji (copy is sentence case with no em dash and no emoji)
  off-scale      a padding, margin or gap in px off Lime's 4px scale (2px and 6px half steps allowed)

Lime rules for components (--lime on a .ts or .tsx file: the same rules, read as Tailwind classes and
script motion; comment lines are skipped)
  weight-700     font-bold, font-extrabold, font-black, font-[700], fontWeight 700
  uppercase      the uppercase class or textTransform "uppercase"
  letter-spacing a tracking-* class other than tracking-tight
  gradient       a gradient class (bg-linear-*, bg-radial-*, bg-conic-*, bg-gradient-*) or a gradient()
  palette        a stock Tailwind colour (bg-red-500, text-white …); every colour is a Lime role
  literal-duration a duration-N, delay-N or [transition-duration:Nms] class, an animate-[… Nms …], or a
                 motion prop (duration: / delay:) with a number; use --dur-* (duration-(--dur-base)) or
                 the typed `motion` from @errand/design-tokens
  curve          an ease-[…], ease-in-out or ease-linear class, a cubic-bezier, a motion `ease: [ … ]`,
                 a spring (type: "spring", stiffness, damping, bounce). A curve spread or interpolated from
                 the typed tokens (`ease: [...motion.easeOut]`, `cubic-bezier(${…})`) is the token itself
  loop           infinite, repeat: Infinity, animate-pulse, animate-bounce, animate-ping
  scroll-reveal  IntersectionObserver or whileInView
  transition-all the transition-all class
  shadow         a shadow-* class other than shadow-none and Lime's shadow-card, -menu, -overlay, -thumb
  font-size      a text-[N…] class or fontSize with a number; use Lime's text-xs … text-3xl
  radius         a rounded-[…] class other than rounded-[inherit], or a stock key Lime lacks (rounded-xs,
                 -lg, -xl, -2xl, -3xl, -4xl); use rounded-sm, -md, -field, -panel, -sheet, -control, -full
  legacy-role    a v2 or shadcn role name (bg-surface-card, text-fg-meta, text-muted-foreground,
                 var(--edge) …), which v3 renamed or dropped
"""
import re
import sys

REGIONS = [("/* ---- primitives", "/* ---- semantic roles"), ("/* ---- lime source", "/* ---- end lime source")]
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
MOTION = re.compile(r"\b(?:transition|animation)(?:-duration)?\s*:([^;}\"]*)")
DURATION = re.compile(r"(?<![\w.-])(\d*\.?\d+)m?s\b")

SCALE = {0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96}
LIME = [
    ("weight-700", re.compile(r"font-weight\s*:\s*(?:700|800|900|bold(?:er)?)\b|<(?:b|strong)\b[^>]*>", re.I)),
    ("uppercase", re.compile(r"text-transform\s*:\s*uppercase", re.I)),
    ("letter-spacing", re.compile(r"letter-spacing\s*:\s*(?!\s)(?!var\(--tracking-tight\)|0\s*[;}\"'])[^;}\"']+")),
    ("gradient", re.compile(r"\b(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(")),
    ("curve", re.compile(r"cubic-bezier\(|(?:transition|animation|easing|transition-timing-function|animation-timing-function)\s*:[^;}]*?(?<![\w.-])(?:ease|ease-in|ease-out|ease-in-out|linear|steps\()(?![\w-])")),
    ("loop", re.compile(r"\binfinite\b|iterations\s*:\s*Infinity")),
    ("scroll-reveal", re.compile(r"IntersectionObserver")),
    ("transition-all", re.compile(r"transition(?:-property)?\s*:\s*all\b")),
    ("shadow", re.compile(r"box-shadow\s*:\s*(?!\s)(?!var\(--shadow-[\w-]+\)\s*[;}\"']|none\b)[^;}\"']+")),
    ("font-size", re.compile(r"font-size\s*:\s*(?:\d|max\((?!var)|min\((?!var)|clamp\((?!var))")),
    ("radius", re.compile(r"border(?:-[a-z]+)*-radius\s*:\s*(?!\s)(?!var\(|0\s*[;}\"']|50%)[^;}\"']+")),
    ("dash-emoji", re.compile("[–—\U0001F000-\U0001FAFF☀-➿⭐⬆✅❌]")),
]
ROLE_PREFIX = r"(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent)-"
LEGACY_ROLE = (
    r"(?:surface-(?:well|canvas|card|raised|glass)|edge(?:-strong|-glass)?|fg-(?:emph|body|meta|faint)|interactive(?:-tint)?"
    r"|ok(?:-tint|-fill)?|on-ok-fill|warn-fill|on-warn-fill|err(?:-tint|-fill)?|on-err-fill|info|brand|cat-\d|chart-\d"
    r"|muted(?:-foreground)?|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?"
    r"|accent-foreground|destructive|background|foreground|input|border|warning|hero-[\w-]+)"
)
PALETTE = (
    r"(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo"
    r"|violet|purple|fuchsia|pink|rose)-\d{2,3})"
)
LIME_CLASSES = [
    ("weight-700", re.compile(r"(?<![\w-])font-(?:bold|extrabold|black|\[[789]00\])(?![\w-])|fontWeight\s*:\s*[\"']?(?:[789]00|bold)")),
    ("uppercase", re.compile(r"(?<![\w-])uppercase(?![\w-])|textTransform\s*:\s*[\"']uppercase")),
    ("letter-spacing", re.compile(r"(?<![\w-])tracking-(?!tight(?![\w-]))[\w\[\](.-]+")),
    ("gradient", re.compile(r"(?<![\w-])bg-(?:linear|radial|conic|gradient)-|\b(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(")),
    ("palette", re.compile(ROLE_PREFIX + PALETTE + r"(?![\w-])")),
    ("literal-duration", re.compile(
        r"(?<![\w-])(?:duration|delay)-(?:\d|\[)|\[(?:transition|animation)-(?:duration|delay):\d|animate-\[[^\]]*\d+m?s"
        r"|(?<![\w-])(?:duration|delay)\s*:\s*(?:reduce[d]?\s*\?\s*0\s*:\s*)?(?:[1-9]|0\.\d)")),
    ("curve", re.compile(
        r"(?<![\w-])ease-(?:\[|in-out(?![\w-])|linear(?![\w-]))|cubic-bezier(?!\(\$\{)|(?<![\w-])ease\s*:\s*\[(?!\.\.\.)|type\s*:\s*[\"']spring|\b(?:stiffness|damping|bounce)\s*:")),
    ("loop", re.compile(r"\binfinite\b|repeat\s*:\s*Infinity|(?<![\w-])animate-(?:pulse|bounce|ping)(?![\w-])")),
    ("scroll-reveal", re.compile(r"IntersectionObserver|whileInView")),
    ("transition-all", re.compile(r"(?<![\w-])transition-all(?![\w-])")),
    ("shadow", re.compile(r"(?<![\w-])(?:inset-|drop-)?shadow-(?!none(?![\w-])|card(?![\w-])|menu(?![\w-])|overlay(?![\w-])|thumb(?![\w-]))[\w\[\](./-]+")),
    ("font-size", re.compile(r"(?<![\w-])text-\[\d|fontSize\s*:\s*[\"']?\d|(?<![\w-])text-(?:[4-9]xl)(?![\w-])")),
    ("radius", re.compile(r"(?<![\w-])rounded(?:-[trblse]{1,2})?-(?:\[(?!inherit\])|(?:xs|lg|xl|2xl|3xl|4xl)(?![\w-]))")),
    ("legacy-role", re.compile(ROLE_PREFIX + LEGACY_ROLE + r"(?![\w-])|var\(--" + LEGACY_ROLE + r"\)|(?<![\w-])text-(?:meta|label|body|panel|title|kpi)(?![\w-])")),
]
COMMENT = re.compile(r"^\s*(?://|/\*|\*)")

SPACING = re.compile(r"(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;}\"']+)")
PX = re.compile(r"(-?\d*\.?\d+)px")


DEFAULT_TOKENS = "packages/design-tokens/tokens.css"


def definitions(text):
    return set(re.findall(r"(--[\w-]+)\s*:", text))


def outside_vendored(lines):
    """Yield (line number, line) for every line outside the vendored regions."""
    end = None
    for n, line in enumerate(lines, 1):
        if end is None:
            for start, stop in REGIONS:
                if start in line:
                    end = stop
                    break
        if end is not None:
            if end in line:
                end = None
            continue
        yield n, line


def lime_findings(lines):
    findings = []
    for n, line in outside_vendored(lines):
        for rule, pattern in LIME:
            for m in pattern.finditer(line):
                if rule in ("loop", "curve") and "lime-spin" in line and m.group(0).strip().endswith(("linear", "infinite")):
                    continue
                findings.append((n, rule, m.group(0).strip()))
        for m in SPACING.finditer(line):
            for px in PX.findall(m.group(1)):
                if abs(float(px)) not in SCALE:
                    findings.append((n, "off-scale", m.group(0).strip()))
    return findings


def class_findings(lines):
    """The Lime rules for a component file, read as Tailwind classes and script motion."""
    findings = []
    for n, line in enumerate(lines, 1):
        if COMMENT.match(line):
            continue
        for rule, pattern in LIME_CLASSES:
            for m in pattern.finditer(line):
                if rule == "loop" and "lime-spin" in line:
                    continue
                findings.append((n, rule, m.group(0).strip()))
    return findings


def script_definitions(text):
    """Custom properties a component sets itself: style={{ "--x": … }} or [--x:…] classes."""
    return set(re.findall(r"[\"'](--[\w-]+)[\"']\s*:", text)) | set(re.findall(r"\[(--[\w-]+):", text))


def check(path, shared=frozenset(), lime=False):
    text = open(path, encoding="utf-8").read()
    findings = []
    lines = text.split("\n")
    for n, line in outside_vendored(lines):
        code = re.sub(r"&#\w+;|#[a-z][\w-]*\b(?=[\s,{:.)\"'\[]|$)", "", line)  # ids and entities are not colours
        for m in COLOR.finditer(code):
            findings.append((n, "raw-color", m.group(0)))
    script = path.endswith((".ts", ".tsx"))
    defined = definitions(text) | shared | (script_definitions(text) if script else set())
    for n, line in enumerate(lines, 1):
        for name in re.findall(r"var\((--[\w-]+)", line):
            # --kc / --kv are set inline per element; --radix-* and --tw-* are set by the libraries
            if name not in defined and not name.startswith(("--k", "--radix-", "--tw-")):
                findings.append((n, "token-parity", name))
    for n, line in enumerate(lines, 1):
        for decl in MOTION.findall(line):
            for m in DURATION.finditer(decl):
                if float(m.group(1)) > 0:
                    findings.append((n, "literal-duration", m.group(0)))
    if "prefers-reduced-motion" not in text and not script:
        findings.append((0, "reduced-motion", "no prefers-reduced-motion block"))
    if re.search(r"\.animate\(|requestAnimationFrame", text) and not re.search(r"\breduced\b|useReducedMotion", text):
        findings.append((0, "reduced-motion", "script animation without a reduced-motion guard"))
    if lime:
        findings += class_findings(lines) if script else lime_findings(lines)
    return sorted(findings)


def parse_args(argv):
    tokens, files, lime = [], [], False
    args = iter(argv)
    for arg in args:
        if arg == "--tokens":
            path = next(args, None)
            if path is None:
                sys.exit("--tokens needs a path")
            tokens.append(path)
        elif arg == "--lime":
            lime = True
        else:
            files.append(arg)
    files = tokens + [f for f in files if f not in tokens]
    return tokens, files or [DEFAULT_TOKENS], lime


def main():
    tokens, files, lime = parse_args(sys.argv[1:])
    shared = set()
    for path in tokens:
        shared |= definitions(open(path, encoding="utf-8").read())
    bad = 0
    for f in files:
        for n, rule, what in check(f, frozenset(shared), lime):
            print("%s:%s %s %s" % (f, n, rule, what))
            bad += 1
    print("%d finding(s) in %d file(s)" % (bad, len(files)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
