
function sum(a: number, b: number) : number {
    return a + b;
}

describe("Tests", () => {
    it("Sum", () => {
      expect(sum(2, 3)).toEqual(5);
    });
  });
