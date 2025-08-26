import Parsimmon from "../src/parsimmon";
export function testSetScenario(fn) {
  describe("", function () {
    fn();

    if (typeof Set !== "undefined") {
      describe("no Set", function () {
        beforeAll(function () {
          Parsimmon._supportsSet = false;
        });

        afterAll(function () {
          Parsimmon._supportsSet = undefined;
        });

        fn();
      });
    }
  });
}
