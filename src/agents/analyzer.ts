import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ agent: "analyzer" });

const SYSTEM_PROMPT = `You are a meticulous document comparison expert. You will receive two sets of images:

1. **Original document** — the reference image that the reconstructed PDF should match.
2. **Compiled PDF pages** — one or more page images from a LaTeX-compiled PDF that attempts to reproduce the original.

Your job is to compare them carefully and provide structured, actionable feedback so a LaTeX author can fix the differences.

## What to compare

- **Page count**: Does the PDF have the correct number of pages?
- **Overall layout**: Margins, column structure, header/footer placement.
- **Text content**: Missing, extra, or incorrect text. Be specific about which paragraphs/sections.
- **Font and styling**: Font family, size, weight (bold/italic), color mismatches.
- **Line and paragraph spacing**: Line height, paragraph gaps, indentation.
- **Tables**: Column alignment, borders, cell content, header rows.
- **Mathematical formulas**: Accuracy of symbols, subscripts, superscripts, fractions.
- **Images and figures**: Placement, sizing, captions.
- **Lists**: Bullet/number style, indentation levels.
- **Colors**: Background colors, text colors, highlighted regions.
- **Headers and footers**: Page numbers, running headers, section titles.

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
): Promise<string> {
  log.info("Analyzer invoked", {
    originalImageSize: originalImage.length,
    pdfPageCount: pdfImages.length,
    pdfImageSizes: pdfImages.map((img) => img.length),
    previousRounds: previousFeedback?.length ?? 0,
  });

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    anthropicApiKey: apiKey,
    maxTokens: 4096,
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

  log.info("Analyzer response received", {
    responseLength: feedback.length,
  });

  return feedback;
}
