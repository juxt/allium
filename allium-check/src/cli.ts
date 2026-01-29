#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'fs';
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { buildSymbols } from './symbols.js';
import { checkReferences } from './checks/references.js';
import { checkEnums } from './checks/enums.js';
import type { Diagnostic } from './types.js';

program
  .name('allium-check')
  .description('Check Allium specification files for errors')
  .version('0.1.0')
  .argument('<file>', 'Allium file to check')
  .action((file: string) => {
    try {
      const source = readFileSync(file, 'utf-8');
      const diagnostics = check(file, source);

      if (diagnostics.length > 0) {
        for (const d of diagnostics) {
          console.error(formatDiagnostic(d));
        }
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof Error) {
        console.error(`error: ${err.message}`);
      }
      process.exit(1);
    }
  });

program.parse();

function check(filename: string, source: string): Diagnostic[] {
  const tokens = lex(source);
  const ast = parse(tokens, filename);

  if (ast.type === 'error') {
    return [ast.diagnostic];
  }

  const symbols = buildSymbols(ast.file);
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkReferences(ast.file, symbols, filename));
  diagnostics.push(...checkEnums(ast.file, symbols, filename));

  return diagnostics;
}

function formatDiagnostic(d: Diagnostic): string {
  const suggestion = d.suggestion ? ` (did you mean '${d.suggestion}'?)` : '';
  return `${d.file}:${d.line}:${d.col}: ${d.message}${suggestion}`;
}
