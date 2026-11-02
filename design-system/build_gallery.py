#!/usr/bin/env python3
"""Inline the generated tokens.css into gallery.html so the gallery is one self-contained file (stdlib only).

    python3 -I design-system/build_gallery.py design-system/gallery.html packages/design-tokens/tokens.css mockups/design-system.html
"""
import sys

LINK = '<link rel="stylesheet" href="../packages/design-tokens/tokens.css">'


def main():
    gallery, tokens, out = sys.argv[1:4]
    html = open(gallery, encoding="utf-8").read()
    if LINK not in html:
        sys.exit("gallery has no generated tokens.css link to replace")
    css = open(tokens, encoding="utf-8").read()
    open(out, "w", encoding="utf-8").write(html.replace(LINK, "<style>\n" + css + "</style>"))
    print("wrote " + out)


if __name__ == "__main__":
    main()
