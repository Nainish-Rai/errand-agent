"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const streamdownPlugins = { cjk, code, math, mermaid };

export type MarkdownProps = ComponentProps<typeof Streamdown>;

const markdownComponents: MarkdownProps["components"] = {
  h1: ({ className, ...props }) => (
    <h1
      className={cn("mt-7 mb-4 px-3 text-xl leading-7 font-semibold", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn("mt-6 mb-3 px-3 text-base leading-6 font-semibold", className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn("mt-5 mb-2 px-3 text-sm leading-6 font-semibold", className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn("mt-4 mb-2 px-3 text-sm leading-6 font-semibold", className)}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn("mt-4 mb-2 px-3 text-xs leading-5 font-semibold", className)}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "mt-4 mb-2 px-3 text-xs leading-5 font-semibold text-fg-3",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("px-3 text-base leading-6 text-fg", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "flex list-disc flex-col gap-1.5 px-3 pl-8 text-base leading-6 text-fg",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "flex list-decimal flex-col gap-1.5 px-3 pl-8 text-base leading-6 text-fg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("pl-1 text-base leading-6 text-fg", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "mx-3 border-l-2 border-line pl-3 text-base leading-6 text-fg-3",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("mx-3 my-4 border-line/70", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-medium text-fg", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "font-medium text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-fg",
        className,
      )}
      rel="noreferrer"
      target="_blank"
      {...props}
    />
  ),
  inlineCode: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-sm text-fg",
        className,
      )}
      {...props}
    />
  ),
};

// Answer text is the model's, and the model may repeat what a tool or a review said. Photos come only
// from the app's registry by image key, so markdown draws no media at all: `![](url)`, raw
// `<img>`, `<picture>`/`<source srcset>`, SVG `<image>` and media posters are dropped before render,
// and no URL survives in a src-like attribute. Nothing in an answer can make the browser fetch.
const MEDIA_ELEMENTS = ["img", "picture", "source", "image", "video", "audio", "track", "iframe", "object", "embed"];
const MEDIA_URL_KEYS = new Set(["src", "srcSet", "srcset", "poster", "background", "xlinkHref"]);

const urlTransform: MarkdownProps["urlTransform"] = (url, key) => (MEDIA_URL_KEYS.has(key) ? "" : url);

export const Markdown = memo(function Markdown({ className, ...props }: MarkdownProps) {
  return (
    <Streamdown
      className={cn(
        "min-w-0 text-base leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      components={markdownComponents}
      plugins={streamdownPlugins}
      {...props}
      disallowedElements={MEDIA_ELEMENTS}
      urlTransform={urlTransform}
    />
  );
});
