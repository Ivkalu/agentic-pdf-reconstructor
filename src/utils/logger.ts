import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp, agent, tool, iteration, ...meta }) => {
  const parts: string[] = [`${timestamp} [${level}]`];

  if (agent) parts.push(`[${agent}]`);
  if (tool) parts.push(`[tool:${tool}]`);
  if (iteration !== undefined) parts.push(`[iter:${iteration}]`);

  parts.push(String(message));

  const extraKeys = Object.keys(meta).filter(
    (k) => !["splat", "label"].includes(k)
  );
  if (extraKeys.length > 0) {
    const extra = Object.fromEntries(extraKeys.map((k) => [k, meta[k]]));
    parts.push(JSON.stringify(extra));
  }

  return parts.join(" ");
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "debug",
  format: combine(timestamp({ format: "HH:mm:ss.SSS" }), logFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss.SSS" }), logFormat),
    }),
  ],
});

export function createChildLogger(defaults: Record<string, unknown>) {
  return logger.child(defaults);
}
