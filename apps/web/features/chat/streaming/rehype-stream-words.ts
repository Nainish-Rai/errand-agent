// A rehype plugin for an answer that is still streaming: every word becomes its own span, so a new word
// mounts whole and blurs in (Streamdown-style per-word animation), while the words already on screen
// keep their DOM nodes. Streamdown turns the tree into React elements keyed by tag and position, so
// appending a word appends a span and leaves the earlier ones alone.
//
// Unlike Streamdown's own animate plugin, the spans carry no per-render duration: that plugin rewrites
// the duration of the words it saw last render to 0, which snaps a word that is still blurring in to
// its end the moment the next word arrives. Here every span keeps one animation, started once.
//
// Code, maths and diagrams are left whole: their text is never split.

type HastText = { type: "text"; value: string };
type HastElement = { type: "element"; tagName: string; properties: Record<string, unknown>; children: HastNode[] };
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const WHOLE = new Set(["code", "pre", "svg", "math", "annotation"]);
const PARTS = /(\s+)/;

function wordSpan(word: string): HastElement {
  return { type: "element", tagName: "span", properties: { dataStreamWord: "" }, children: [{ type: "text", value: word }] };
}

function splitText(node: HastText): HastNode[] {
  return node.value
    .split(PARTS)
    .filter((part) => part !== "")
    .map((part) => (part.trim() === "" ? { type: "text", value: part } : wordSpan(part)));
}

function wrapWords(node: HastNode): void {
  if (!("children" in node) || node.children === undefined) return;
  if (node.type === "element" && WHOLE.has((node as HastElement).tagName)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text") return splitText(child as HastText);
    wrapWords(child);
    return [child];
  });
}

/** The plugin: `rehypePlugins={[...defaults, rehypeStreamWords]}`. */
export function rehypeStreamWords() {
  return (tree: HastNode) => wrapWords(tree);
}
