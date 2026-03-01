// parsimmon-fork.d.ts
// Complete TypeScript definitions for the ESM fork of Parsimmon
// Compatible with `import P from 'parsimmon-fork'`

export interface Index {
  offset: number;
  line: number;
  column: number;
}

export interface ParseSuccess<T> {
  status: true;
  value: T;
}

export interface ParseFailure {
  status: false;
  index: Index;
  expected: string[];
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface Marked<T> {
  start: Index;
  value: T;
  end: Index;
}

export interface SyntaxNode<T> {
  name: string;
  value: T;
  start: Index;
  end: Index;
}

export default class Parsimmon<T> {
  // ===== Instance methods =====
  parse(input: string | Buffer): ParseResult<T>;
  tryParse(input: string | Buffer): T;

  map<U>(fn: (value: T) => U): Parsimmon<U>;
  chain<U>(fn: (value: T) => Parsimmon<U>): Parsimmon<U>;
  then<U>(next: Parsimmon<U>): Parsimmon<U>;
  skip<U>(next: Parsimmon<U>): Parsimmon<T>;
  or<U>(other: Parsimmon<U>): Parsimmon<T | U>;
  fallback(value: T): Parsimmon<T>;
  ap<U>(parser: Parsimmon<(value: T) => U>): Parsimmon<U>;

  many(): Parsimmon<T[]>;
  times(count: number): Parsimmon<T[]>;
  times(min: number, max: number): Parsimmon<T[]>;

  atLeast(n: number): Parsimmon<T[]>;
  atMost(n: number): Parsimmon<T[]>;

  sepBy<U>(separator: Parsimmon<U>): Parsimmon<T[]>;
  sepBy1<U>(separator: Parsimmon<U>): Parsimmon<T[]>;

  wrap<L, R>(left: Parsimmon<L>, right: Parsimmon<R>): Parsimmon<T>;
  trim<U>(parser: Parsimmon<U>): Parsimmon<T>;

  desc(description: string | string[]): Parsimmon<T>;
  mark(): Parsimmon<Marked<T>>;
  node(name: string): Parsimmon<SyntaxNode<T>>;
  lookahead<U>(parser: Parsimmon<U>): Parsimmon<T>;
  notFollowedBy<U>(parser: Parsimmon<U>): Parsimmon<null>;

  // Fantasy-land compatibility
  ['fantasy-land/map']<U>(fn: (value: T) => U): Parsimmon<U>;
  ['fantasy-land/chain']<U>(fn: (value: T) => Parsimmon<U>): Parsimmon<U>;

  // ===== Static methods =====
  static string(str: string): Parsimmon<string>;
  static regexp(re: RegExp, group?: number): Parsimmon<string>;
  static alt<T>(...parsers: Parsimmon<T>[]): Parsimmon<T>;
  static seq<T extends any[]>(...parsers: { [K in keyof T]: Parsimmon<T[K]> }): Parsimmon<T>;
  static seqMap<A, B>(p1: Parsimmon<A>, mapFn: (a: A) => B): Parsimmon<B>;
  static seqMap<A, B, C>(p1: Parsimmon<A>, p2: Parsimmon<B>, mapFn: (a: A, b: B) => C): Parsimmon<C>;
  static seqMap<A, B, C, D>(p1: Parsimmon<A>, p2: Parsimmon<B>, p3: Parsimmon<C>, mapFn: (a: A, b: B, c: C) => D): Parsimmon<D>;

  static lazy<T>(fn: () => Parsimmon<T>): Parsimmon<T>;
  static lazy<T>(desc: string, fn: () => Parsimmon<T>): Parsimmon<T>;

  static succeed<T>(value: T): Parsimmon<T>;
  static fail(message: string): Parsimmon<never>;
  static eof(): Parsimmon<null>;

  static any(): Parsimmon<string>;
  static all(): Parsimmon<string>;
  static index(): Parsimmon<Index>;

  static whitespace(): Parsimmon<string>;
  static optWhitespace(): Parsimmon<string>;

  static digit(): Parsimmon<string>;
  static digits(): Parsimmon<string>;

  static letter(): Parsimmon<string>;
  static letters(): Parsimmon<string>;

  // Additional character helpers from the source repo
  static oneOf(str: string): Parsimmon<string>;
  static noneOf(str: string): Parsimmon<string>;
  static takeWhile(predicate: (char: string) => boolean): Parsimmon<string>;
  static test(predicate: (char: string) => boolean): Parsimmon<string>;
  static range(start: string, end: string): Parsimmon<string>;
}
