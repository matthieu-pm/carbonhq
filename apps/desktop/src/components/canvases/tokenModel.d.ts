import type { Token, TokenKind } from "./document";
export const tokenProperty: Record<TokenKind, string>;
export function normalizeToken(kind: TokenKind, value: string): string;
export function parseTokens(markdown: string, parse: (source: string) => unknown): Token[];
