// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { redact } from './redact.js';

// Logs go to stderr as JSON lines. stdout is reserved for MCP protocol
// messages when running as a stdio server, so nothing here may touch it.
// Callers pass structured fields only; never pass email content or queries.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export type LogSink = (line: string) => void;

export function createLogger(
  sink: LogSink = (line) => process.stderr.write(line + '\n'),
  level: Level = (process.env.CMEC_LOG_LEVEL as Level) || 'info',
): Logger {
  const min = ORDER[level] ?? ORDER.info;
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const entry = { ts: new Date().toISOString(), level: lvl, msg: redact(msg), ...(redact(fields ?? {}) as object) };
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
