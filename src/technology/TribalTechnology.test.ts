import { describe, expect, it } from "vitest";
import {
  TRIBAL_TECHNOLOGIES,
  createInitialTribeResearch,
  researchPlanForTarget,
  technologyActionState,
} from "./TribalTechnology";

describe("TribalTechnology", () => {
  it("defines a 31-node acyclic knowledge web", () => {
    expect(TRIBAL_TECHNOLOGIES).toHaveLength(31);
    expect(new Set(TRIBAL_TECHNOLOGIES.map((technology) => technology.id)).size).toBe(31);
  });

  it("builds a prerequisite-first route to a locked destination", () => {
    const plan = researchPlanForTarget(createInitialTribeResearch(1), "village-planning");
    expect(plan.at(-1)).toBe("village-planning");
    expect(plan.indexOf("council-customs")).toBeLessThan(plan.indexOf("village-planning"));
    expect(plan.indexOf("permanent-dwellings")).toBeLessThan(
      plan.indexOf("village-planning"),
    );
  });

  it("exposes legal opening choices without pretending the Tribe knows nothing", () => {
    const research = createInitialTribeResearch(1);
    expect(technologyActionState(research, "seasonal-lore")).toBe("available");
    expect(technologyActionState(research, "field-cultivation")).toBe("blocked");
  });
});
