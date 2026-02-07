# Agentic PDF Reconstructor

An autonomous multi-agent system that reconstructs documents from images into pixel-accurate LaTeX PDFs. Give it a screenshot of a document and it will write, compile, visually evaluate, and iteratively refine the LaTeX until the output matches the original.

Also includes a **Video Analyzer** that extracts semantically distinct frames from video using OCR, TF-IDF, and clustering.

## How It Works

### The Agentic Loop

The core of this project is a self-directed agent loop built with **LangGraph**. There is no hardcoded sequence of steps — the agent decides what to do next based on the current state, using tools as it sees fit.

```
                    ┌──────────────────────────────────────┐
                    │                                      │
  Image ──► Agent Node ──► Tool Calls ──► Tool Node ──────┘
               │                            │
               │ (no tool calls             │ (done tool called)
               │  or max iterations)        │
               ▼                            ▼
              END                          END
```

The agent operates in a **think → act → observe → think** cycle:

1. **Analyze** the input document image (layout, fonts, spacing, tables, formulas, colors)
2. **Write** a complete LaTeX document via the `write_latex` tool
3. **Compile** it to PDF via the `compile_pdf` tool (runs `pdflatex` twice for references/TOC)
4. **Verify** by calling `verify_pdf`, which triggers a second agent (the Analyzer) to visually compare the compiled PDF against the original
5. **Iterate** — read the Analyzer's feedback, fix the LaTeX, recompile, verify again
6. **Finish** — call `done` when the result is good enough or no further progress can be made

The agent is free to call tools in any order, retry on errors, read back its own LaTeX, or bail out early. The graph enforces a maximum of 10 iterations as a safety bound.

### Two Cooperating Agents

| Agent | Role | Model |
|-------|------|-------|
| **Reconstructor** | Primary agent. Analyzes images, writes LaTeX, manages the full reconstruction loop. Has access to all 5 tools. | Claude Sonnet |
| **Analyzer** | Evaluation agent. Receives the original image and the compiled PDF pages, performs a detailed visual comparison, and returns structured, actionable feedback. | Claude Sonnet |

The Analyzer is not a passive checker — it **maintains a feedback history** across iterations and actively adapts its strategy:

- Tracks which issues were fixed and which persist
- Escalates specificity when suggestions are ignored (e.g., from "fix the margins" to "use `\usepackage[left=2.5cm, right=2.5cm]{geometry}`")
- Prioritizes the most impactful remaining issues instead of repeating long lists
- Recognizes when the result is "good enough" after multiple rounds

This creates a genuine multi-agent feedback loop where the Analyzer coaches the Reconstructor toward convergence.

### Tools

The Reconstructor agent has 5 tools, each implemented as a LangChain `DynamicStructuredTool` with Zod schema validation:

| Tool | What it does |
|------|-------------|
| `write_latex` | Writes the complete LaTeX document to disk (full replace, not incremental edits) |
| `read_latex` | Reads the current LaTeX source, with optional line offset/limit for large files |
| `compile_pdf` | Runs `pdflatex` twice, parses the log for errors, saves iteration snapshots |
| `verify_pdf` | Converts the PDF to images via `pdftoppm`, then invokes the Analyzer agent for visual comparison |
| `done` | Signals completion with an explanation — triggers workflow termination |

Each compilation saves a snapshot (`iteration_1.pdf`, `iteration_2.pdf`, ...) so you can see how the document evolves across iterations.

### State Management

The LangGraph state tracks three things:

- **messages** — the full conversation history (accumulated via LangGraph's message reducer)
- **iterationCount** — how many agent turns have happened
- **isDone** — whether the `done` tool was called

Routing is conditional: after the agent node, the graph checks for tool calls and routes accordingly. After tool execution, it loops back to the agent unless `done` was triggered or the iteration limit is reached.

## Video Analyzer

A separate pipeline for extracting representative frames from video. Rather than naive interval sampling, it uses text-based semantic clustering to find genuinely distinct frames.

```
Video ──► Frame Extraction ──► OCR (parallel) ──► TF-IDF ──► Clustering ──► Representative Selection
            (ffmpeg)           (tesseract)       (bigrams)   (K-Means /      (centroid-nearest)
                                                              DBSCAN)
```

1. **Extract frames** at 15 fps using ffmpeg (downscaled to 1280px, JPEG quality 5)
2. **OCR every frame** with tesseract using a concurrent worker pool (default 8 workers)
3. **Build a TF-IDF matrix** from the OCR text using unigram + bigram tokenization with L2 normalization
4. **Cluster** frames by text similarity — K-Means (auto k = sqrt(n/2)) or DBSCAN with cosine distance
5. **Select representatives** by picking the frame closest to each cluster centroid in TF-IDF space

Results are cached by SHA-256 video hash so re-uploading the same video skips extraction and OCR.

## Quick Start

**Prerequisites:** Node.js 20+, `pdflatex`, `pdftoppm`, `ffmpeg`, `tesseract` (or use Docker)

```bash
# Install dependencies
npm install

# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# CLI mode — reconstruct a single image
npm run dev -- input.png

# Web server mode
npm run dev:server
# Open http://localhost:3000

# Docker (includes all system dependencies)
docker compose up
```

## Architecture

```
src/
├── agents/
│   ├── reconstructor.ts    # Primary agent — system prompt + model config
│   └── analyzer.ts         # Evaluation agent — visual comparison
├── graph/
│   └── index.ts            # LangGraph workflow — state, routing, execution
├── tools/
│   ├── writeLatex.ts       # Write complete LaTeX documents
│   ├── readLatex.ts        # Read LaTeX source
│   ├── compilePdf.ts       # pdflatex compilation + error parsing
│   ├── verifyPdf.ts        # PDF→image conversion + Analyzer invocation
│   └── done.ts             # Completion signal
├── video-analyzer/
│   ├── frameExtractor.ts   # ffmpeg frame extraction
│   ├── ocr.ts              # tesseract OCR with worker pool
│   ├── tfidf.ts            # TF-IDF vectorization
│   ├── clustering.ts       # K-Means and DBSCAN clustering
│   └── representativeSelection.ts  # Centroid-nearest frame selection
├── server/
│   ├── index.ts            # Express API server
│   └── jobStore.ts         # File-based async job persistence
├── public/                 # Web UI (drag-and-drop upload, iteration gallery)
└── index.ts                # CLI entry point
```

## Tech Stack

- **LangGraph** — agentic workflow orchestration (state graph, conditional routing, tool nodes)
- **LangChain** — tool abstractions, Anthropic model integration
- **Claude Sonnet** — vision + text model for both agents
- **Express** — web server with async background job processing
- **pdflatex** / **pdftoppm** — LaTeX compilation and PDF-to-image conversion
- **ffmpeg** / **tesseract** — video frame extraction and OCR
- **ml-kmeans** / **density-clustering** — frame clustering algorithms
