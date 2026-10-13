import { describe, expect, it } from "vitest";
import { genderLabel, genderSplit, statTotal } from "./speciesInfo";

const fmt = (n: number) => String(n).replace(".", ",");

describe("speciesInfo", () => {
  it("reparto de géneros de los GenderRatio de Essentials", () => {
    expect(genderSplit("FemaleOneEighth")).toEqual({ male: 87.5, female: 12.5 });
    expect(genderSplit("Female50Percent")).toEqual({ male: 50, female: 50 });
    expect(genderSplit("FemaleSevenEighths")).toEqual({ male: 12.5, female: 87.5 });
    expect(genderSplit("AlwaysMale")).toEqual({ male: 100, female: 0 });
    expect(genderSplit("AlwaysFemale")).toEqual({ male: 0, female: 100 });
    expect(genderSplit("Genderless")).toBeNull();
    expect(genderSplit(null)).toBeNull();
    expect(genderSplit("Raro")).toBeNull();
  });

  it("etiqueta compacta", () => {
    expect(genderLabel("FemaleOneEighth", fmt)).toBe("87,5 % ♂ · 12,5 % ♀");
    expect(genderLabel("AlwaysFemale", fmt)).toBe("100 % ♀");
    expect(genderLabel("AlwaysMale", fmt)).toBe("100 % ♂");
    expect(genderLabel("Genderless", fmt)).toBeNull();
  });

  it("suma los stats base", () => {
    expect(statTotal({ HP: 45, ATTACK: 49, DEFENSE: 49, SPECIAL_ATTACK: 65, SPECIAL_DEFENSE: 65, SPEED: 45 })).toBe(318);
    expect(statTotal(undefined)).toBe(0);
  });
});
