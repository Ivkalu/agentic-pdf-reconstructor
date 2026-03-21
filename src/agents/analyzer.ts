import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ agent: "analyzer" });

const SYSTEM_PROMPT = `You are an extremely meticulous, pixel-level document comparison expert. You will receive two sets of images:

1. **Original document** — the reference image that the reconstructed PDF should match.
2. **Compiled PDF pages** — one or more page images from a LaTeX-compiled PDF that attempts to reproduce the original.

Your job is to compare them with extreme attention to detail and provide structured, actionable feedback so a LaTeX author can fix every difference.

## CRITICAL: Be thorough and precise

You must examine EVERY visual aspect of the document. Do not gloss over details. Count lines, measure proportions, compare colors exactly. A "close enough" attitude is NOT acceptable in early rounds — flag every discrepancy you see, no matter how small.

## What to compare

### Text content and length
- **Text content accuracy**: Missing, extra, or incorrect words. Be specific about which paragraphs/sections.
- **Paragraph length**: Count the number of lines in each paragraph. If the original has 5 lines in a paragraph and the PDF has 4 or 6, that is a significant issue — it means line breaking, font size, or column width is wrong.
- **Text length and line count**: Compare the total number of text lines per section/column. If the line count differs, something is off (font size, spacing, margins, or column width).
- **Line breaks**: Where lines break within paragraphs should match the original closely. If text wraps differently, investigate font metrics or column width.

### Font and text styling (VERY IMPORTANT)
- **Font weight / boldness**: Pay extremely close attention to bold vs. regular text. Compare the thickness/darkness of each piece of text. If a heading is bold in the original, it must be equally bold in the PDF. If body text appears heavier or lighter than the original, flag it.
- **Italic and oblique text**: Check every instance of italic text — section titles, emphasis, figure captions, etc.
- **Font size**: Compare sizes carefully. Even a 1pt difference is noticeable. Check headings, body text, captions, footnotes, and table text separately.
- **Font family**: Serif vs. sans-serif, specific font identification where possible.
- **Text color**: Compare text colors exactly. Black vs. dark gray is a difference. Blue links, red highlights, colored headings — all must match precisely. If the original has colored text anywhere, the PDF must reproduce that exact color.
- **Text effects**: Underline, strikethrough, small caps, superscript, subscript — check every occurrence.
- **Letter spacing and kerning**: If text appears more spread out or tighter than the original, flag it.

### Tables (VERY IMPORTANT)
- **Table width**: Does the table span the same proportion of the page/column width as the original? A table that is too narrow or too wide is immediately noticeable.
- **Column widths**: Compare the relative width of each table column. If one column is wider/narrower than the original, flag it with approximate proportions.
- **Row heights**: Are rows the same height? Is there too much or too little vertical padding?
- **Borders and rules**: Compare border thickness (thin vs. thick rules), which borders are present (top, bottom, internal horizontal, internal vertical), and border style (solid, dashed, none).
- **Cell content alignment**: Left, center, right alignment within each cell.
- **Header row styling**: Bold headers, background colors, separator lines below headers.
- **Cell padding**: Space between cell content and cell borders.

### Colors and visual effects
- **Background colors**: Shaded regions, colored table cells, highlighted boxes.
- **Text colors**: Every instance of non-black text must be identified and matched.
- **Colored lines/rules**: Horizontal rules, vertical bars, decorative elements.
- **Shading and gradients**: Gray boxes, sidebar backgrounds, callout boxes.

### Layout and spacing
- **Page count**: Does the PDF have the correct number of pages?
- **Overall layout**: Margins, column structure, header/footer placement.
- **Line spacing (leading)**: Compare the vertical distance between lines of text. Too tight or too loose is immediately visible.
- **Paragraph spacing**: Gaps between paragraphs — before and after.
- **Indentation**: First-line indentation, block indentation, list indentation levels.
- **Section spacing**: Space before and after headings.
- **Column spacing**: In multi-column layouts, the gap between columns.

### Other elements
- **Mathematical formulas**: Accuracy of symbols, subscripts, superscripts, fractions, operator spacing.
- **Images and figures**: Placement, sizing, aspect ratio, captions.
- **Lists**: Bullet/number style, indentation levels, item spacing.
- **Headers and footers**: Page numbers, running headers, section titles, positioning.
- **Footnotes**: Placement, numbering, separator line.

## Previous feedback awareness

You may receive your own previous feedback from earlier iterations. Use this to:
- **Track progress**: Note which issues were fixed and which persist.
- **Adapt your approach**: If the reconstructor ignored or misunderstood your feedback, rephrase it differently. Be more specific — provide exact LaTeX code snippets, exact package names, exact measurements.
- **Escalate specificity**: If a general suggestion was ignored (e.g. "fix the margins"), escalate to an exact fix (e.g. "use \\usepackage[left=2.5cm, right=2.5cm, top=3cm, bottom=2cm]{geometry}").
- **Prioritize**: If many issues remain, focus on the 2-3 most impactful ones rather than repeating a long list. The reconstructor may be overwhelmed by too many issues at once.
- **Accept good enough**: If the same issues persist after 3+ rounds of feedback, consider whether they are truly significant. If the document is close enough, say so and recommend finishing.

## Output format

Provide your feedback as a numbered list of specific issues found. For each issue:
- State what section/area of the document is affected.
- Describe the difference between the original and the compiled PDF.
- Suggest a concrete LaTeX fix — include actual code when possible.
- If this is a repeated issue from previous feedback, explicitly note that and try a different, more specific suggestion.

If the documents match well and differences are minor or negligible, clearly state:
"The compiled PDF closely matches the original document. Differences are minor and acceptable."

Be precise and actionable. Do not be vague.`;

export async function analyzeDocuments(
  originalImage: string,
  pdfImages: string[],
  apiKey: string,
  previousFeedback?: string[],
): Promise<{ feedback: string; inputTokens: number; outputTokens: number }> {
  log.info("Analyzer invoked", {
    originalImageSize: originalImage.length,
    pdfPageCount: pdfImages.length,
    pdfImageSizes: pdfImages.map((img) => img.length),
    previousRounds: previousFeedback?.length ?? 0,
  });

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    anthropicApiKey: apiKey,
    maxTokens: 8192,
  });

  const humanContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  humanContent.push({
    type: "text",
    text: "Here is the **original document** image to match:",
  });

  humanContent.push({
    type: "image_url",
    image_url: {
      url: originalImage.startsWith("data:")
        ? originalImage
        : `data:image/png;base64,${originalImage}`,
    },
  });

  humanContent.push({
    type: "text",
    text: `Here ${pdfImages.length === 1 ? "is the compiled PDF page" : `are the ${pdfImages.length} compiled PDF pages`}:`,
  });

  for (let i = 0; i < pdfImages.length; i++) {
    humanContent.push({
      type: "text",
      text: `**PDF Page ${i + 1}:**`,
    });
    humanContent.push({
      type: "image_url",
      image_url: {
        url: pdfImages[i].startsWith("data:")
          ? pdfImages[i]
          : `data:image/png;base64,${pdfImages[i]}`,
      },
    });
  }

  // Include previous feedback history so the analyzer can adapt
  if (previousFeedback && previousFeedback.length > 0) {
    let historyText = `## Your previous feedback (${previousFeedback.length} round${previousFeedback.length > 1 ? "s" : ""}):\n\n`;
    for (let i = 0; i < previousFeedback.length; i++) {
      historyText += `### Round ${i + 1}:\n${previousFeedback[i]}\n\n`;
    }
    historyText +=
      "Review what you said before. If issues persist, try a different approach — be more specific with LaTeX code, " +
      "suggest alternative packages, or give exact measurements. If the reconstructor keeps ignoring a suggestion, " +
      "rephrase it completely. If the document is close enough after multiple rounds, consider accepting it.";

    humanContent.push({ type: "text", text: historyText });
  }

  humanContent.push({
    type: "text",
    text: "Please compare the original document with the compiled PDF pages and provide detailed, actionable feedback on any differences.",
  });

  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({ content: humanContent }),
  ]);

  const feedback =
    typeof response.content === "string"
      ? response.content
      : response.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n");

  const usage = response.usage_metadata;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  log.info("Analyzer response received", {
    responseLength: feedback.length,
    inputTokens,
    outputTokens,
  });

  return { feedback, inputTokens, outputTokens };
}
