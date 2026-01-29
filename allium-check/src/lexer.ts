import type { Loc } from './types.js';

export type TokenType =
  // Keywords
  | 'entity' | 'external' | 'value' | 'rule' | 'when' | 'let' | 'requires' | 'ensures'
  | 'default' | 'deferred' | 'open' | 'question' | 'for' | 'this' | 'with' | 'becomes'
  | 'created' | 'config' | 'now'
  // Operators
  | 'and' | 'or' | 'not' | 'in' | 'true' | 'false' | 'null'
  // Punctuation
  | '{' | '}' | '(' | ')' | '[' | ']' | ':' | ',' | '|' | '?' | '.' | '=>'
  // Comparison/arithmetic
  | '=' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/'
  // Literals and identifiers
  | 'ident' | 'number' | 'string'
  // Special
  | 'eof' | 'newline';

export type Token = {
  type: TokenType;
  value: string;
  loc: Loc;
};

const KEYWORDS = new Set([
  'entity', 'external', 'value', 'rule', 'when', 'let', 'requires', 'ensures',
  'default', 'deferred', 'open', 'question', 'for', 'this', 'with', 'becomes',
  'created', 'config', 'now', 'and', 'or', 'not', 'in', 'true', 'false', 'null'
]);

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function loc(): Loc {
    return { line, col };
  }

  function peek(offset = 0): string {
    return source[pos + offset] ?? '';
  }

  function advance(): string {
    const ch = source[pos++];
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function skipWhitespace(): void {
    while (pos < source.length) {
      const ch = peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        advance();
      } else if (ch === '\n') {
        advance();
      } else if (ch === '-' && peek(1) === '-') {
        // Comment - skip to end of line
        while (pos < source.length && peek() !== '\n') {
          advance();
        }
      } else {
        break;
      }
    }
  }

  function readIdent(): string {
    let ident = '';
    while (pos < source.length && /[a-zA-Z0-9_]/.test(peek())) {
      ident += advance();
    }
    return ident;
  }

  function readNumber(): string {
    let num = '';
    while (pos < source.length && /[0-9.]/.test(peek())) {
      num += advance();
    }
    return num;
  }

  function readString(): string {
    const quote = advance(); // consume opening quote
    let str = '';
    while (pos < source.length && peek() !== quote) {
      if (peek() === '\\') {
        advance();
        str += advance();
      } else {
        str += advance();
      }
    }
    advance(); // consume closing quote
    return str;
  }

  while (pos < source.length) {
    skipWhitespace();
    if (pos >= source.length) break;

    const startLoc = loc();
    const ch = peek();

    // Single char tokens
    if ('{}()[]:,|?.+-*/'.includes(ch)) {
      advance();
      tokens.push({ type: ch as TokenType, value: ch, loc: startLoc });
      continue;
    }

    // Multi-char operators
    if (ch === '=' && peek(1) === '>') {
      advance(); advance();
      tokens.push({ type: '=>', value: '=>', loc: startLoc });
      continue;
    }
    if (ch === '!' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: '!=', value: '!=', loc: startLoc });
      continue;
    }
    if (ch === '<' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: '<=', value: '<=', loc: startLoc });
      continue;
    }
    if (ch === '>' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: '>=', value: '>=', loc: startLoc });
      continue;
    }
    if (ch === '<') {
      advance();
      tokens.push({ type: '<', value: '<', loc: startLoc });
      continue;
    }
    if (ch === '>') {
      advance();
      tokens.push({ type: '>', value: '>', loc: startLoc });
      continue;
    }
    if (ch === '=') {
      advance();
      tokens.push({ type: '=', value: '=', loc: startLoc });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      const ident = readIdent();
      const type = KEYWORDS.has(ident) ? ident as TokenType : 'ident';
      tokens.push({ type, value: ident, loc: startLoc });
      continue;
    }

    // Number
    if (/[0-9]/.test(ch)) {
      const num = readNumber();
      tokens.push({ type: 'number', value: num, loc: startLoc });
      continue;
    }

    // String
    if (ch === '"' || ch === "'") {
      const str = readString();
      tokens.push({ type: 'string', value: str, loc: startLoc });
      continue;
    }

    // Unknown character - skip it
    advance();
  }

  tokens.push({ type: 'eof', value: '', loc: loc() });
  return tokens;
}
