if (typeof Buffer === "undefined") {
  // eslint-disable-next-line no-unused-vars
  class Buffer extends Uint8Array {
    constructor(arg) {
      super(arg);
    }
    static isBuffer(buf) {
      return buf instanceof Buffer;
    }
    static from(arr) {
      const uarr = super.from(arr);
      const buf = new Buffer(uarr.length);
      for (let i = 0; i < arr.length; i++) {
        buf[i] = uarr[i];
      }
      return buf;
    }
    readUInt16BE(start) {
      const view = new DataView(this.buffer);
      return view.getUint16(start);
    }
  }
}

class Parsimmon {
  // -*- Error Formatting Constants as Static Properties -*-
  static linesBeforeStringError = 2;
  static linesAfterStringError = 3;
  static bytesPerLine = 8;
  static bytesBefore = 40; // bytesPerLine * 5
  static bytesAfter = 32; // bytesPerLine * 4
  static defaultLinePrefix = "  ";

  static lineColumnIndex = {};

  constructor(action) {
    if (!(this instanceof Parsimmon)) {
      return new Parsimmon(action);
    }
    this._ = action;
  }

  // -*- Core Parsing Methods -*-

  parse(input) {
    if (typeof input !== "string" && !Parsimmon.isBuffer(input)) {
      throw new Error(
        ".parse must be called with a string or Buffer as its argument",
      );
    }
    const parseResult = this.skip(Parsimmon.eof)._(input, 0);

    let result;
    if (parseResult.status) {
      result = {
        status: true,
        value: parseResult.value,
      };
    } else {
      result = {
        status: false,
        index: Parsimmon.makeLineColumnIndex(input, parseResult.furthest),
        expected: parseResult.expected,
      };
    }

    // release memory from lineColumnIndex now we are done parsing
    delete Parsimmon.lineColumnIndex[input];

    return result;
  }

  // -*- Other Methods -*-

  tryParse(str) {
    const result = this.parse(str);
    if (result.status) {
      return result.value;
    } else {
      const msg = Parsimmon.formatError(str, result);
      const err = new Error(msg);
      err.type = "ParsimmonError";
      err.result = result;
      throw err;
    }
  }

  assert(condition, errorMessage) {
    return this.chain((value) =>
      condition(value)
        ? Parsimmon.succeed(value)
        : Parsimmon.fail(errorMessage),
    );
  }

  static or(alternative) {
    return Parsimmon.alt(this, alternative);
  }
  or = Parsimmon.or;
  concat = Parsimmon.or;

  trim(parser) {
    return this.wrap(parser, parser);
  }

  wrap(leftParser, rightParser) {
    return Parsimmon.seqMap(
      leftParser,
      this,
      rightParser,
      (left, middle) => middle,
    );
  }

  thru(wrapper) {
    return wrapper(this);
  }

  then(next) {
    Parsimmon.assertParser(next);
    return Parsimmon.seq(this, next).map((results) => results[1]);
  }

  many() {
    return new Parsimmon((input, i) => {
      const accum = [];
      let result = undefined;

      for (;;) {
        result = Parsimmon.mergeReplies(this._(input, i), result);
        if (result.status) {
          if (i === result.index) {
            throw new Error(
              "infinite loop detected in .many() parser --- calling .many() on " +
                "a parser which can accept zero characters is usually the cause",
            );
          }
          i = result.index;
          accum.push(result.value);
        } else {
          return Parsimmon.mergeReplies(
            Parsimmon.makeSuccess(i, accum),
            result,
          );
        }
      }
    });
  }

  tieWith(separator) {
    Parsimmon.assertString(separator);
    return this.map((args) => {
      Parsimmon.assertArray(args);
      if (args.length) {
        Parsimmon.assertString(args[0]);
        let s = args[0];
        for (let i = 1; i < args.length; i++) {
          Parsimmon.assertString(args[i]);
          s += separator + args[i];
        }
        return s;
      } else {
        return "";
      }
    });
  }

  tie() {
    return this.tieWith("");
  }

  times(min, max) {
    if (arguments.length < 2) {
      max = min;
    }
    Parsimmon.assertNumber(min);
    Parsimmon.assertNumber(max);
    return new Parsimmon((input, i) => {
      const accum = [];
      let result = undefined;
      let prevResult = undefined;
      let times;
      for (times = 0; times < min; times += 1) {
        result = this._(input, i);
        prevResult = Parsimmon.mergeReplies(result, prevResult);
        if (result.status) {
          i = result.index;
          accum.push(result.value);
        } else {
          return prevResult;
        }
      }
      for (; times < max; times += 1) {
        result = this._(input, i);
        prevResult = Parsimmon.mergeReplies(result, prevResult);
        if (result.status) {
          i = result.index;
          accum.push(result.value);
        } else {
          break;
        }
      }
      return Parsimmon.mergeReplies(
        Parsimmon.makeSuccess(i, accum),
        prevResult,
      );
    });
  }

  result(res) {
    return this.map(() => res);
  }

  atMost(n) {
    return this.times(0, n);
  }

  atLeast(n) {
    return Parsimmon.seqMap(this.times(n), this.many(), (init, rest) =>
      init.concat(rest),
    );
  }

  static map(fn) {
    Parsimmon.assertFunction(fn);
    return new Parsimmon((input, i) => {
      const result = this._(input, i);
      if (!result.status) {
        return result;
      }
      return Parsimmon.mergeReplies(
        Parsimmon.makeSuccess(result.index, fn(result.value)),
        result,
      );
    });
  }
  map = Parsimmon.map;

  contramap(fn) {
    Parsimmon.assertFunction(fn);
    return new Parsimmon((input, i) => {
      const result = this.parse(fn(input.slice(i)));
      if (!result.status) {
        return result;
      }
      return Parsimmon.makeSuccess(i + input.length, result.value);
    });
  }

  promap(f, g) {
    Parsimmon.assertFunction(f);
    Parsimmon.assertFunction(g);
    return this.contramap(f).map(g);
  }

  skip(next) {
    return Parsimmon.seq(this, next).map((results) => results[0]);
  }

  mark() {
    return Parsimmon.seqMap(
      Parsimmon.index,
      this,
      Parsimmon.index,
      (start, value, end) => ({
        start,
        value,
        end,
      }),
    );
  }

  node(name) {
    return Parsimmon.seqMap(
      Parsimmon.index,
      this,
      Parsimmon.index,
      (start, value, end) => ({
        name,
        value,
        start,
        end,
      }),
    );
  }

  sepBy(separator) {
    return Parsimmon.sepBy(this, separator);
  }

  sepBy1(separator) {
    return Parsimmon.sepBy1(this, separator);
  }

  lookahead(x) {
    return this.skip(Parsimmon.lookahead(x));
  }

  notFollowedBy(x) {
    return this.skip(Parsimmon.notFollowedBy(x));
  }

  desc(expected) {
    if (!Parsimmon.isArray(expected)) {
      expected = [expected];
    }
    return new Parsimmon((input, i) => {
      const reply = this._(input, i);
      if (!reply.status) {
        reply.expected = expected;
      }
      return reply;
    });
  }

  fallback(result) {
    return this.or(Parsimmon.succeed(result));
  }

  static ap(other) {
    return Parsimmon.seqMap(other, this, (f, x) => f(x));
  }
  ap = Parsimmon.ap;

  static chain(f) {
    return new Parsimmon((input, i) => {
      const result = this._(input, i);
      if (!result.status) {
        return result;
      }
      const nextParser = f(result.value);
      return Parsimmon.mergeReplies(nextParser._(input, result.index), result);
    });
  }
  chain = Parsimmon.chain;

  // -*- Static Methods -*-

  static times(n, f) {
    for (let i = 0; i < n; i++) {
      f(i);
    }
  }

  static sum(numArr) {
    return numArr.reduce((x, y) => x + y, 0);
  }

  static bufferExists() {
    return typeof Buffer !== "undefined";
  }

  static setExists() {
    if (Parsimmon._supportsSet !== undefined) {
      return Parsimmon._supportsSet;
    }
    const exists = typeof Set !== "undefined";
    Parsimmon._supportsSet = exists;
    return exists;
  }

  static ensureBuffer() {
    if (!Parsimmon.bufferExists()) {
      throw new Error(
        "Buffer global does not exist; please use webpack if you need to parse Buffers in the browser.",
      );
    }
  }

  static isParser(obj) {
    return obj instanceof Parsimmon;
  }

  static isArray(x) {
    return {}.toString.call(x) === "[object Array]";
  }

  static isBuffer(x) {
    return Parsimmon.bufferExists() && Buffer.isBuffer(x);
  }

  static makeSuccess(index, value) {
    return {
      status: true,
      index: index,
      value: value,
      furthest: -1,
      expected: [],
    };
  }

  static makeFailure(index, expected) {
    if (!Parsimmon.isArray(expected)) {
      expected = [expected];
    }
    return {
      status: false,
      index: -1,
      value: null,
      furthest: index,
      expected: expected,
    };
  }

  static mergeReplies(result, last) {
    if (!last) {
      return result;
    }
    if (result.furthest > last.furthest) {
      return result;
    }
    const expected =
      result.furthest === last.furthest
        ? Parsimmon.union(result.expected, last.expected)
        : last.expected;
    return {
      status: result.status,
      index: result.index,
      value: result.value,
      furthest: last.furthest,
      expected: expected,
    };
  }

  static union(xs, ys) {
    // for newer browsers/node we can improve performance by using
    // modern JS
    if (Parsimmon.setExists() && Array.from) {
      const set = new Set(xs);
      for (let y = 0; y < ys.length; y++) {
        set.add(ys[y]);
      }
      const arr = Array.from(set);
      arr.sort();
      return arr;
    }
    const obj = {};
    for (let i = 0; i < xs.length; i++) {
      obj[xs[i]] = true;
    }
    for (let j = 0; j < ys.length; j++) {
      obj[ys[j]] = true;
    }
    const keys = [];
    for (const k in obj) {
      if ({}.hasOwnProperty.call(obj, k)) {
        keys.push(k);
      }
    }
    keys.sort();
    return keys;
  }

  static get(input, i) {
    if (typeof input === "string") {
      return input.charAt(i);
    }
    return input[i];
  }

  static toArray(arrLike) {
    return Array.prototype.slice.call(arrLike);
  }

  static assertParser(p) {
    if (!Parsimmon.isParser(p)) {
      throw new Error("not a parser: " + p);
    }
  }

  static assertArray(x) {
    if (!Parsimmon.isArray(x)) {
      throw new Error("not an array: " + x);
    }
  }

  static assertNumber(x) {
    if (typeof x !== "number") {
      throw new Error("not a number: " + x);
    }
  }

  static assertRegexp(x) {
    if (!(x instanceof RegExp)) {
      throw new Error("not a regexp: " + x);
    }
    const f = Parsimmon.flags(x);
    for (let i = 0; i < f.length; i++) {
      const c = f.charAt(i);
      // Only allow regexp flags [imus] for now, since [g] and [y] specifically
      // mess up Parsimmon. If more non-stateful regexp flags are added in the
      // future, this will need to be revisited.
      if (c !== "i" && c !== "m" && c !== "u" && c !== "s") {
        throw new Error('unsupported regexp flag "' + c + '": ' + x);
      }
    }
  }

  static assertFunction(x) {
    if (typeof x !== "function") {
      throw new Error("not a function: " + x);
    }
  }

  static assertString(x) {
    if (typeof x !== "string") {
      throw new Error("not a string: " + x);
    }
  }

  static flags(re) {
    if (re.flags !== undefined) {
      return re.flags;
    }
    // legacy browser support
    return [
      re.global ? "g" : "",
      re.ignoreCase ? "i" : "",
      re.multiline ? "m" : "",
      re.unicode ? "u" : "",
      re.sticky ? "y" : "",
    ].join("");
  }

  static lshiftBuffer(input) {
    const asTwoBytes = input.reduce(
      (a, v, i, b) =>
        a.concat(
          i === b.length - 1
            ? Buffer.from([v, 0]).readUInt16BE(0)
            : b.readUInt16BE(i),
        ),
      [],
    );
    return Buffer.from(asTwoBytes.map((x) => ((x << 1) & 0xffff) >> 8));
  }

  static consumeBitsFromBuffer(n, input) {
    let state = { v: 0, buf: input };
    Parsimmon.times(n, () => {
      state = {
        v: (state.v << 1) | Parsimmon.bitPeekBuffer(state.buf),
        buf: Parsimmon.lshiftBuffer(state.buf),
      };
    });
    return state;
  }

  static bitPeekBuffer(input) {
    return input[0] >> 7;
  }

  static isInteger(value) {
    return typeof value === "number" && Math.floor(value) === value;
  }

  static assertValidIntegerByteLengthFor(who, length) {
    if (!Parsimmon.isInteger(length) || length < 0 || length > 6) {
      throw new Error(who + " requires integer length in range [0, 6].");
    }
  }

  static bitSeq(alignments) {
    Parsimmon.ensureBuffer();
    const totalBits = Parsimmon.sum(alignments);
    if (totalBits % 8 !== 0) {
      throw new Error(
        "The bits [" +
          alignments.join(", ") +
          "] add up to " +
          totalBits +
          " which is not an even number of bytes; the total should be divisible by 8",
      );
    }
    const bytes = totalBits / 8;

    const tooBigRange = alignments.find((x) => x > 48);
    if (tooBigRange) {
      throw new Error(
        tooBigRange +
          " bit range requested exceeds 48 bit (6 byte) Number max.",
      );
    }

    return new Parsimmon((input, i) => {
      const newPos = bytes + i;
      if (newPos > input.length) {
        return Parsimmon.makeFailure(i, bytes.toString() + " bytes");
      }
      return Parsimmon.makeSuccess(
        newPos,
        alignments.reduce(
          (acc, bits) => {
            const state = Parsimmon.consumeBitsFromBuffer(bits, acc.buf);
            return {
              coll: acc.coll.concat(state.v),
              buf: state.buf,
            };
          },
          { coll: [], buf: input.slice(i, newPos) },
        ).coll,
      );
    });
  }

  static bitSeqObj(namedAlignments) {
    Parsimmon.ensureBuffer();
    const seenKeys = {};
    let totalKeys = 0;
    const fullAlignments = namedAlignments.map((item) => {
      if (Parsimmon.isArray(item)) {
        const pair = item;
        if (pair.length !== 2) {
          throw new Error(
            "[" +
              pair.join(", ") +
              "] should be length 2, got length " +
              pair.length,
          );
        }
        Parsimmon.assertString(pair[0]);
        Parsimmon.assertNumber(pair[1]);
        if (Object.prototype.hasOwnProperty.call(seenKeys, pair[0])) {
          throw new Error("duplicate key in bitSeqObj: " + pair[0]);
        }
        seenKeys[pair[0]] = true;
        totalKeys++;
        return pair;
      } else {
        Parsimmon.assertNumber(item);
        return [null, item];
      }
    });
    if (totalKeys < 1) {
      throw new Error(
        "bitSeqObj expects at least one named pair, got [" +
          namedAlignments.join(", ") +
          "]",
      );
    }
    const namesOnly = fullAlignments.map((pair) => pair[0]);
    const alignmentsOnly = fullAlignments.map((pair) => pair[1]);

    return Parsimmon.bitSeq(alignmentsOnly).map((parsed) => {
      const namedParsed = namesOnly.map((name, i) => [name, parsed[i]]);

      return namedParsed.reduce((obj, kv) => {
        if (kv[0] !== null) {
          obj[kv[0]] = kv[1];
        }
        return obj;
      }, {});
    });
  }

  static parseBufferFor(other, length) {
    return new Parsimmon((input, i) => {
      Parsimmon.ensureBuffer();
      if (i + length > input.length) {
        return Parsimmon.makeFailure(i, length + " bytes for " + other);
      }
      return Parsimmon.makeSuccess(i + length, input.slice(i, i + length));
    });
  }

  static parseBuffer(length) {
    return Parsimmon.parseBufferFor("buffer", length).map((unsafe) =>
      Buffer.from(unsafe),
    );
  }

  static encodedString(encoding, length) {
    return Parsimmon.parseBufferFor("string", length).map((buff) =>
      buff.toString(encoding),
    );
  }

  static uintBE(length) {
    Parsimmon.assertValidIntegerByteLengthFor("uintBE", length);
    return Parsimmon.parseBufferFor("uintBE(" + length + ")", length).map(
      (buff) => buff.readUIntBE(0, length),
    );
  }

  static uintLE(length) {
    Parsimmon.assertValidIntegerByteLengthFor("uintLE", length);
    return Parsimmon.parseBufferFor("uintLE(" + length + ")", length).map(
      (buff) => buff.readUIntLE(0, length),
    );
  }

  static intBE(length) {
    Parsimmon.assertValidIntegerByteLengthFor("intBE", length);
    return Parsimmon.parseBufferFor("intBE(" + length + ")", length).map(
      (buff) => buff.readIntBE(0, length),
    );
  }

  static intLE(length) {
    Parsimmon.assertValidIntegerByteLengthFor("intLE", length);
    return Parsimmon.parseBufferFor("intLE(" + length + ")", length).map(
      (buff) => buff.readIntLE(0, length),
    );
  }

  static floatBE() {
    return Parsimmon.parseBufferFor("floatBE", 4).map((buff) =>
      buff.readFloatBE(0),
    );
  }

  static floatLE() {
    return Parsimmon.parseBufferFor("floatLE", 4).map((buff) =>
      buff.readFloatLE(0),
    );
  }

  static doubleBE() {
    return Parsimmon.parseBufferFor("doubleBE", 8).map((buff) =>
      buff.readDoubleBE(0),
    );
  }

  static doubleLE() {
    return Parsimmon.parseBufferFor("doubleLE", 8).map((buff) =>
      buff.readDoubleLE(0),
    );
  }

  // -*- Base Parsers as Static Properties -*-

  static get index() {
    return new Parsimmon((input, i) =>
      Parsimmon.makeSuccess(i, Parsimmon.makeLineColumnIndex(input, i)),
    );
  }

  static get any() {
    return new Parsimmon((input, i) => {
      if (i >= input.length) {
        return Parsimmon.makeFailure(i, "any character/byte");
      }
      return Parsimmon.makeSuccess(i + 1, Parsimmon.get(input, i));
    });
  }

  static get all() {
    return new Parsimmon((input, i) =>
      Parsimmon.makeSuccess(input.length, input.slice(i)),
    );
  }

  static get eof() {
    return new Parsimmon((input, i) => {
      if (i < input.length) {
        return Parsimmon.makeFailure(i, "EOF");
      }
      return Parsimmon.makeSuccess(i, null);
    });
  }

  static get digit() {
    return Parsimmon.regexp(/[0-9]/).desc("a digit");
  }

  static get digits() {
    return Parsimmon.regexp(/[0-9]*/).desc("optional digits");
  }

  static get letter() {
    return Parsimmon.regexp(/[a-z]/i).desc("a letter");
  }

  static get letters() {
    return Parsimmon.regexp(/[a-z]*/i).desc("optional letters");
  }

  static get optWhitespace() {
    return Parsimmon.regexp(/\s*/).desc("optional whitespace");
  }

  static get whitespace() {
    return Parsimmon.regexp(/\s+/).desc("whitespace");
  }

  static get cr() {
    return Parsimmon.string("\r");
  }

  static get lf() {
    return Parsimmon.string("\n");
  }

  static get crlf() {
    return Parsimmon.string("\r\n");
  }

  static get newline() {
    return Parsimmon.alt(Parsimmon.crlf, Parsimmon.lf, Parsimmon.cr).desc(
      "newline",
    );
  }

  static get end() {
    return Parsimmon.alt(Parsimmon.newline, Parsimmon.eof);
  }

  // -*- Error Formatting Constants -*-

  static makeLineColumnIndex(input, i) {
    if (Parsimmon.isBuffer(input)) {
      return {
        offset: i,
        line: -1,
        column: -1,
      };
    }

    // initialize if we haven't seen this input yet
    if (!(input in Parsimmon.lineColumnIndex)) {
      Parsimmon.lineColumnIndex[input] = {};
    }

    const inputIndex = Parsimmon.lineColumnIndex[input];

    let prevLine = 0;
    let newLines = 0;
    let lineStart = 0;
    let j = i;
    while (j >= 0) {
      if (j in inputIndex) {
        prevLine = inputIndex[j].line;
        // lineStart === 0 when we haven't found a new line on the walk
        // back from i, so we are on the same line as the previously cached
        // index
        if (lineStart === 0) {
          lineStart = inputIndex[j].lineStart;
        }
        break;
      }

      if (
        // Unix LF (\n) or Windows CRLF (\r\n) line ending
        input.charAt(j) === "\n" ||
        // Old Mac CR (\r) line ending
        (input.charAt(j) === "\r" && input.charAt(j + 1) !== "\n")
      ) {
        newLines++;
        // lineStart === 0 when this is the first new line we have found
        if (lineStart === 0) {
          lineStart = j + 1;
        }
      }
      j--;
    }

    const lineWeAreUpTo = prevLine + newLines;
    const columnWeAreUpTo = i - lineStart;

    inputIndex[i] = { line: lineWeAreUpTo, lineStart: lineStart };

    // lines and columns are 1-indexed
    return {
      offset: i,
      line: lineWeAreUpTo + 1,
      column: columnWeAreUpTo + 1,
    };
  }

  static repeat(string, amount) {
    return new Array(amount + 1).join(string);
  }

  static formatExpected(expected) {
    if (expected.length === 1) {
      return "Expected:\n\n" + expected[0];
    }
    return "Expected one of the following: \n\n" + expected.join(", ");
  }

  static leftPad(str, pad, char) {
    const add = pad - str.length;
    if (add <= 0) {
      return str;
    }
    return Parsimmon.repeat(char, add) + str;
  }

  static toChunks(arr, chunkSize) {
    const length = arr.length;
    const chunks = [];
    let chunkIndex = 0;

    if (length <= chunkSize) {
      return [arr.slice()];
    }

    for (let i = 0; i < length; i++) {
      if (!chunks[chunkIndex]) {
        chunks.push([]);
      }

      chunks[chunkIndex].push(arr[i]);

      if ((i + 1) % chunkSize === 0) {
        chunkIndex++;
      }
    }

    return chunks;
  }

  static rangeFromIndexAndOffsets(i, before, after, length) {
    return {
      // Guard against the negative upper bound for lines included in the output.
      from: i - before > 0 ? i - before : 0,
      to: i + after > length ? length : i + after,
    };
  }

  static byteRangeToRange(byteRange) {
    // Exception for inputs smaller than `bytesPerLine`
    if (byteRange.from === 0 && byteRange.to === 1) {
      return {
        from: byteRange.from,
        to: byteRange.to,
      };
    }

    return {
      from: byteRange.from / Parsimmon.bytesPerLine,
      // Round `to`, so we don't get float if the amount of bytes is not divisible by `bytesPerLine`
      to: Math.floor(byteRange.to / Parsimmon.bytesPerLine),
    };
  }

  static formatGot(input, error) {
    const index = error.index;
    const i = index.offset;

    let verticalMarkerLength = 1;
    let column;
    let lineWithErrorIndex;
    let lines;
    let lineRange;
    let lastLineNumberLabelLength;

    if (i === input.length) {
      return "Got the end of the input";
    }

    if (Parsimmon.isBuffer(input)) {
      const byteLineWithErrorIndex = i - (i % Parsimmon.bytesPerLine);
      const columnByteIndex = i - byteLineWithErrorIndex;
      const byteRange = Parsimmon.rangeFromIndexAndOffsets(
        byteLineWithErrorIndex,
        Parsimmon.bytesBefore,
        Parsimmon.bytesAfter + Parsimmon.bytesPerLine,
        input.length,
      );
      const bytes = input.slice(byteRange.from, byteRange.to);
      const bytesInChunks = Parsimmon.toChunks(
        bytes.toJSON().data,
        Parsimmon.bytesPerLine,
      );

      const byteLines = bytesInChunks.map((byteRow) =>
        byteRow.map((byteValue) =>
          // Prefix byte values with a `0` if they are shorter than 2 characters.
          Parsimmon.leftPad(byteValue.toString(16), 2, "0"),
        ),
      );

      lineRange = Parsimmon.byteRangeToRange(byteRange);
      lineWithErrorIndex = byteLineWithErrorIndex / Parsimmon.bytesPerLine;
      column = columnByteIndex * 3;

      // Account for an extra space.
      if (columnByteIndex >= 4) {
        column += 1;
      }

      verticalMarkerLength = 2;
      lines = byteLines.map((byteLine) =>
        byteLine.length <= 4
          ? byteLine.join(" ")
          : byteLine.slice(0, 4).join(" ") + "  " + byteLine.slice(4).join(" "),
      );
      lastLineNumberLabelLength = (
        (lineRange.to > 0 ? lineRange.to - 1 : lineRange.to) * 8
      ).toString(16).length;

      if (lastLineNumberLabelLength < 2) {
        lastLineNumberLabelLength = 2;
      }
    } else {
      const inputLines = input.split(/\r\n|[\n\r\u2028\u2029]/);
      column = index.column - 1;
      lineWithErrorIndex = index.line - 1;
      lineRange = Parsimmon.rangeFromIndexAndOffsets(
        lineWithErrorIndex,
        Parsimmon.linesBeforeStringError,
        Parsimmon.linesAfterStringError,
        inputLines.length,
      );

      lines = inputLines.slice(lineRange.from, lineRange.to);
      lastLineNumberLabelLength = lineRange.to.toString().length;
    }

    const lineWithErrorCurrentIndex = lineWithErrorIndex - lineRange.from;

    if (Parsimmon.isBuffer(input)) {
      lastLineNumberLabelLength = (
        (lineRange.to > 0 ? lineRange.to - 1 : lineRange.to) * 8
      ).toString(16).length;

      if (lastLineNumberLabelLength < 2) {
        lastLineNumberLabelLength = 2;
      }
    }

    const linesWithLineNumbers = lines.reduce((acc, lineSource, index) => {
      const isLineWithError = index === lineWithErrorCurrentIndex;
      const prefix = isLineWithError ? "> " : Parsimmon.defaultLinePrefix;
      let lineNumberLabel;

      if (Parsimmon.isBuffer(input)) {
        lineNumberLabel = Parsimmon.leftPad(
          ((lineRange.from + index) * 8).toString(16),
          lastLineNumberLabelLength,
          "0",
        );
      } else {
        lineNumberLabel = Parsimmon.leftPad(
          (lineRange.from + index + 1).toString(),
          lastLineNumberLabelLength,
          " ",
        );
      }

      return [].concat(
        acc,
        [prefix + lineNumberLabel + " | " + lineSource],
        isLineWithError
          ? [
              Parsimmon.defaultLinePrefix +
                Parsimmon.repeat(" ", lastLineNumberLabelLength) +
                " | " +
                Parsimmon.leftPad("", column, " ") +
                Parsimmon.repeat("^", verticalMarkerLength),
            ]
          : [],
      );
    }, []);

    return linesWithLineNumbers.join("\n");
  }

  static formatError(input, error) {
    return [
      "\n",
      "-- PARSING FAILED " + Parsimmon.repeat("-", 50),
      "\n\n",
      Parsimmon.formatGot(input, error),
      "\n\n",
      Parsimmon.formatExpected(error.expected),
      "\n",
    ].join("");
  }

  static anchoredRegexp(re) {
    return RegExp("^(?:" + re.source + ")", Parsimmon.flags(re));
  }

  // -*- Combinators -*-

  static seq() {
    const parsers = [].slice.call(arguments);
    const numParsers = parsers.length;
    for (let j = 0; j < numParsers; j += 1) {
      Parsimmon.assertParser(parsers[j]);
    }
    return new Parsimmon((input, i) => {
      let result;
      const accum = new Array(numParsers);
      for (let j = 0; j < numParsers; j += 1) {
        result = Parsimmon.mergeReplies(parsers[j]._(input, i), result);
        if (!result.status) {
          return result;
        }
        accum[j] = result.value;
        i = result.index;
      }
      return Parsimmon.mergeReplies(Parsimmon.makeSuccess(i, accum), result);
    });
  }

  static seqObj() {
    const seenKeys = {};
    let totalKeys = 0;
    const parsers = Parsimmon.toArray(arguments);
    const numParsers = parsers.length;
    for (let j = 0; j < numParsers; j += 1) {
      const p = parsers[j];
      if (Parsimmon.isParser(p)) {
        continue;
      }
      if (Parsimmon.isArray(p)) {
        const isWellFormed =
          p.length === 2 &&
          typeof p[0] === "string" &&
          Parsimmon.isParser(p[1]);
        if (isWellFormed) {
          const key = p[0];
          if (Object.prototype.hasOwnProperty.call(seenKeys, key)) {
            throw new Error("seqObj: duplicate key " + key);
          }
          seenKeys[key] = true;
          totalKeys++;
          continue;
        }
      }
      throw new Error(
        "seqObj arguments must be parsers or [string, parser] array pairs.",
      );
    }
    if (totalKeys === 0) {
      throw new Error("seqObj expects at least one named parser, found zero");
    }
    return new Parsimmon((input, i) => {
      let result;
      const accum = {};
      for (let j = 0; j < numParsers; j += 1) {
        let name;
        let parser;
        if (Parsimmon.isArray(parsers[j])) {
          name = parsers[j][0];
          parser = parsers[j][1];
        } else {
          name = null;
          parser = parsers[j];
        }
        result = Parsimmon.mergeReplies(parser._(input, i), result);
        if (!result.status) {
          return result;
        }
        if (name) {
          accum[name] = result.value;
        }
        i = result.index;
      }
      return Parsimmon.mergeReplies(Parsimmon.makeSuccess(i, accum), result);
    });
  }

  static seqMap() {
    const args = [].slice.call(arguments);
    if (args.length === 0) {
      throw new Error("seqMap needs at least one argument");
    }
    const mapper = args.pop();
    Parsimmon.assertFunction(mapper);
    return Parsimmon.seq
      .apply(null, args)
      .map((results) => mapper.apply(null, results));
  }

  static createLanguage(parsers) {
    const language = {};
    for (const key in parsers) {
      if ({}.hasOwnProperty.call(parsers, key)) {
        ((key) => {
          const func = () => parsers[key](language);
          language[key] = Parsimmon.lazy(func);
        })(key);
      }
    }
    return language;
  }

  static alt() {
    const parsers = [].slice.call(arguments);
    const numParsers = parsers.length;
    if (numParsers === 0) {
      return Parsimmon.fail("zero alternates");
    }
    for (let j = 0; j < numParsers; j += 1) {
      Parsimmon.assertParser(parsers[j]);
    }
    return new Parsimmon((input, i) => {
      let result;
      for (let j = 0; j < parsers.length; j += 1) {
        result = Parsimmon.mergeReplies(parsers[j]._(input, i), result);
        if (result.status) {
          return result;
        }
      }
      return result;
    });
  }

  static sepBy(parser, separator) {
    // Argument asserted by sepBy1
    return Parsimmon.sepBy1(parser, separator).or(Parsimmon.succeed([]));
  }

  static sepBy1(parser, separator) {
    Parsimmon.assertParser(parser);
    Parsimmon.assertParser(separator);
    const pairs = separator.then(parser).many();
    return Parsimmon.seqMap(parser, pairs, (r, rs) => [r].concat(rs));
  }

  // -*- Constructors -*-

  static string(str) {
    Parsimmon.assertString(str);
    const expected = "'" + str + "'";
    return new Parsimmon((input, i) => {
      const j = i + str.length;
      const head = input.slice(i, j);
      if (head === str) {
        return Parsimmon.makeSuccess(j, head);
      } else {
        return Parsimmon.makeFailure(i, expected);
      }
    });
  }

  static byte(b) {
    Parsimmon.ensureBuffer();
    Parsimmon.assertNumber(b);
    if (b > 0xff) {
      throw new Error(
        "Value specified to byte constructor (" +
          b +
          "=0x" +
          b.toString(16) +
          ") is larger in value than a single byte.",
      );
    }
    const expected = (b > 0xf ? "0x" : "0x0") + b.toString(16);
    return new Parsimmon((input, i) => {
      const head = Parsimmon.get(input, i);
      if (head === b) {
        return Parsimmon.makeSuccess(i + 1, head);
      } else {
        return Parsimmon.makeFailure(i, expected);
      }
    });
  }

  static regexp(re, group) {
    Parsimmon.assertRegexp(re);
    if (arguments.length >= 2) {
      Parsimmon.assertNumber(group);
    } else {
      group = 0;
    }
    const anchored = Parsimmon.anchoredRegexp(re);
    const expected = "" + re;
    return new Parsimmon((input, i) => {
      const match = anchored.exec(input.slice(i));
      if (match) {
        if (0 <= group && group <= match.length) {
          const fullMatch = match[0];
          const groupMatch = match[group];
          return Parsimmon.makeSuccess(i + fullMatch.length, groupMatch);
        }
        const message =
          "valid match group (0 to " + match.length + ") in " + expected;
        return Parsimmon.makeFailure(i, message);
      }
      return Parsimmon.makeFailure(i, expected);
    });
  }

  static succeed(value) {
    return new Parsimmon((input, i) => Parsimmon.makeSuccess(i, value));
  }

  static fail(expected) {
    return new Parsimmon((input, i) => Parsimmon.makeFailure(i, expected));
  }

  static lookahead(x) {
    if (Parsimmon.isParser(x)) {
      return new Parsimmon((input, i) => {
        const result = x._(input, i);
        result.index = i;
        result.value = "";
        return result;
      });
    } else if (typeof x === "string") {
      return Parsimmon.lookahead(Parsimmon.string(x));
    } else if (x instanceof RegExp) {
      return Parsimmon.lookahead(Parsimmon.regexp(x));
    }
    throw new Error("not a string, regexp, or parser: " + x);
  }

  static notFollowedBy(parser) {
    Parsimmon.assertParser(parser);
    return new Parsimmon((input, i) => {
      const result = parser._(input, i);
      const text = input.slice(i, result.index);
      return result.status
        ? Parsimmon.makeFailure(i, 'not "' + text + '"')
        : Parsimmon.makeSuccess(i, null);
    });
  }

  static test(predicate) {
    Parsimmon.assertFunction(predicate);
    return new Parsimmon((input, i) => {
      const char = Parsimmon.get(input, i);
      if (i < input.length && predicate(char)) {
        return Parsimmon.makeSuccess(i + 1, char);
      } else {
        return Parsimmon.makeFailure(
          i,
          "a character/byte matching " + predicate,
        );
      }
    });
  }

  static oneOf(str) {
    const expected = str.split("");
    for (let idx = 0; idx < expected.length; idx++) {
      expected[idx] = "'" + expected[idx] + "'";
    }
    return Parsimmon.test((ch) => str.indexOf(ch) >= 0).desc(expected);
  }

  static noneOf(str) {
    return Parsimmon.test((ch) => str.indexOf(ch) < 0).desc(
      "none of '" + str + "'",
    );
  }

  static custom(parsingFunction) {
    return new Parsimmon(
      parsingFunction(Parsimmon.makeSuccess, Parsimmon.makeFailure),
    );
  }

  static range(begin, end) {
    return Parsimmon.test((ch) => begin <= ch && ch <= end).desc(
      begin + "-" + end,
    );
  }

  static takeWhile(predicate) {
    Parsimmon.assertFunction(predicate);

    return new Parsimmon((input, i) => {
      let j = i;
      while (j < input.length && predicate(Parsimmon.get(input, j))) {
        j++;
      }
      return Parsimmon.makeSuccess(j, input.slice(i, j));
    });
  }

  static lazy(desc, f) {
    if (arguments.length < 2) {
      f = desc;
      desc = undefined;
    }

    const parser = new Parsimmon((input, i) => {
      parser._ = f()._;
      return parser._(input, i);
    });

    if (desc) {
      return parser.desc(desc);
    } else {
      return parser;
    }
  }

  // -*- Fantasy Land Extras -*-

  static empty() {
    return Parsimmon.fail("fantasy-land/empty");
  }
  empty = Parsimmon.empty;

  // -*- Fantasy Land Compatibility -*-

  static concat = Parsimmon.or;
  static of = Parsimmon.succeed;
  of = Parsimmon.of;
  "fantasy-land/ap" = Parsimmon.ap;
  "fantasy-land/chain" = Parsimmon.chain;
  "fantasy-land/concat" = Parsimmon.concat;
  "fantasy-land/empty" = Parsimmon.empty;
  "fantasy-land/of" = Parsimmon.of;
  "fantasy-land/map" = Parsimmon.map;
  static "fantasy-land/ap" = Parsimmon.ap;
  static "fantasy-land/chain" = Parsimmon.chain;
  static "fantasy-land/concat" = Parsimmon.concat;
  static "fantasy-land/empty" = Parsimmon.empty;
  static "fantasy-land/of" = Parsimmon.of;
  static "fantasy-land/map" = Parsimmon.map;

  static regex = Parsimmon.regexp;
}

// -*- Static Method Assignments -*-

Parsimmon.Parser = Parsimmon;
// Parsimmon.sepBy = Parsimmon.sepBy;

Parsimmon.Binary = {
  bitSeq: Parsimmon.bitSeq,
  bitSeqObj: Parsimmon.bitSeqObj,
  byte: Parsimmon.byte,
  buffer: Parsimmon.parseBuffer,
  encodedString: Parsimmon.encodedString,
  uintBE: Parsimmon.uintBE,
  uint8BE: Parsimmon.uintBE(1),
  uint16BE: Parsimmon.uintBE(2),
  uint32BE: Parsimmon.uintBE(4),
  uintLE: Parsimmon.uintLE,
  uint8LE: Parsimmon.uintLE(1),
  uint16LE: Parsimmon.uintLE(2),
  uint32LE: Parsimmon.uintLE(4),
  intBE: Parsimmon.intBE,
  int8BE: Parsimmon.intBE(1),
  int16BE: Parsimmon.intBE(2),
  int32BE: Parsimmon.intBE(4),
  intLE: Parsimmon.intLE,
  int8LE: Parsimmon.intLE(1),
  int16LE: Parsimmon.intLE(2),
  int32LE: Parsimmon.intLE(4),
  floatBE: Parsimmon.floatBE(),
  floatLE: Parsimmon.floatLE(),
  doubleBE: Parsimmon.doubleBE(),
  doubleLE: Parsimmon.doubleLE(),
};

export default Parsimmon;
