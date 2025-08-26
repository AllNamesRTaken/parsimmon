import Parsimmon from "../../src/parsimmon.js";

describe("parser.thru", function () {
  it("should return wrapper(this)", function () {
    function arrayify(x) {
      return [x];
    }
    var parser = Parsimmon.string("");
    var array = parser.thru(arrayify);
    assert.strictEqual(array[0], parser);
  });
});
