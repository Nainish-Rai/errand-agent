#!/usr/bin/env python3
"""Inline tokens.css into gallery.html so the gallery is one self-contained file (stdlib only).

    python3 -I build_gallery.py gallery.html tokens.css ../mockups/design-system.html
"""
import sys

LINK = '<link rel="stylesheet" href="tokens.css">'


def main():
    gallery, tokens, out = sys.argv[1:4]
    html = open(gallery, encoding="utf-8").read()
    if LINK not in html:
        sys.exit("gallery has no tokens.css link to replace")
    css = open(tokens, encoding="utf-8").read()
    open(out, "w", encoding="utf-8").write(html.replace(LINK, "<style>\n" + css + "</style>"))
    print("wrote " + out)


if __name__ == "__main__":
    main()
