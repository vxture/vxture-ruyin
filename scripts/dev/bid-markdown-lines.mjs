import { readFileSync } from "node:fs";
import { parseDocument } from "../../packages/document/dist/index.js";

const { root } = parseDocument(readFileSync(process.argv[2], "utf8"));
function paragraph(node) {
  if (node.type !== "paragraph" || node.children.some((child) => child.type !== "text")) {
    throw new Error("This template probe supports plain paragraphs and flat lists only.");
  }
  return node.children.map((child) => child.value).join("").replace(/\r?\n/g, " ");
}
const lines = root.children.flatMap((node) => {
  if (node.type === "paragraph") return [paragraph(node)];
  if (node.type !== "list") throw new Error("Unsupported Markdown block: " + node.type);
  return node.children.map((item, i) => {
    if (item.checked != null || item.children.length !== 1) throw new Error("Unsupported list item");
    return (node.ordered ? ((node.start ?? 1) + i) + ". " : "• ") + paragraph(item.children[0]);
  });
});
if (!lines.length) throw new Error("Chapter is empty");
process.stdout.write(JSON.stringify(lines));
