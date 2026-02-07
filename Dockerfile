FROM node:20-slim

# Install LaTeX, poppler-utils, ffmpeg, and tesseract-ocr
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-latex-recommended \
    texlive-fonts-recommended \
    texlive-science \
    texlive-pictures \
    latexmk \
    poppler-utils \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hrv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Create workspace directory for temporary LaTeX files
RUN mkdir -p /workspace

# Default input/output directories and uploads directory
RUN mkdir -p /app/input /app/output /app/uploads

EXPOSE 3000

# Default: run the web server. Override with CLI entrypoint for video analyzer.
CMD ["node", "dist/server/index.js"]
