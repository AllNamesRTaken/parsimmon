import Parsimmon from "../../src/parsimmon.js";

describe("byte", function () {
  it("matches a buffer byte", function () {
    var b = Buffer.from([0xf]);
    var p = Parsimmon.Binary.byte(0xf);
    assert.ok(p.parse(b).value);
  });

  it("formats single digit bytes like 0x0f", function () {
    var b = Buffer.from([0xa]);
    var p = Parsimmon.Binary.byte(0xf);
    assert.deepEqual(p.parse(b).expected, ["0x0f"]);
  });

  it("formats double digit bytes like 0xff", function () {
    var b = Buffer.from([0x12]);
    var p = Parsimmon.Binary.byte(0xff);
    assert.deepEqual(p.parse(b).expected, ["0xff"]);
  });

  it("disallows larger values than a byte.", function () {
    assert.throws(function () {
      Parsimmon.Binary.byte(0xfff);
    }, /4095=0xfff/);
  });

  describe("Buffer is not present.", function () {
    var buff;
    beforeAll(function () {
      buff = global.Buffer;
      global.Buffer = undefined;
    });

    afterAll(function () {
      global.Buffer = buff;
    });

    it("Disallows construction.", function () {
      assert.throws(function () {
        Parsimmon.Binary.byte(0xf);
      }, /buffer global/i);
    });
  });
});
