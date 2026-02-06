FROM node:20-slim

# Install LaTeX and poppler-utils for PDF compilation and image conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-latex-recommended \
    texlive-fonts-recommended \
    texlive-science \
    texlive-pictures \
    latexmk \
    poppler-utils \
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

# Default input/output directories
RUN mkdir -p /app/input /app/output

ENTRYPOINT ["node", "dist/index.js"]
