import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_APPEARANCE, newProfileAppearance, moveProfileAppearance, profileAppearance, type ProfileAppearances } from "./profileAppearance";

const work = { icon: "briefcase", color: "blue" } as const;
const personal = { icon: "heart", color: "pink" } as const;

describe("profile appearance persistence", () => {
  it("offers an unused preset when creating a profile", () => {
    expect(newProfileAppearance({ Work: { icon: "folder", color: "red" } }, ["Work"])).toEqual({ icon: "folder", color: "orange" });
  });

  it("keeps old profiles usable without metadata", () => {
    for (const stored of [undefined, null, [], "invalid", {}]) {
      expect(profileAppearance(stored, "Work")).toEqual(DEFAULT_PROFILE_APPEARANCE);
    }
  });

  it("validates icon and color independently on read", () => {
    expect(profileAppearance({ Work: { icon: "missing", color: "blue" } }, "Work")).toEqual({ icon: "folder", color: "blue" });
    expect(profileAppearance({ Work: { icon: "heart", color: "#123456" } }, "Work")).toEqual({ icon: "heart", color: "gray" });
    expect(profileAppearance({ Work: null }, "Work")).toEqual(DEFAULT_PROFILE_APPEARANCE);
  });

  it("keeps appearance through a JSON round trip", () => {
    expect(profileAppearance(JSON.parse(JSON.stringify({ Work: work })), "Work")).toEqual(work);
  });

  it("moves only the renamed profile and leaves the old name clear", () => {
    const saved = { Work: work, Personal: personal };
    const renamed = moveProfileAppearance(saved, "Work", "Studio");
    expect(renamed).toEqual({ Studio: work, Personal: personal });
    expect(saved).toEqual({ Work: work, Personal: personal });
    expect(profileAppearance(renamed, "Work")).toEqual(DEFAULT_PROFILE_APPEARANCE);
  });

  it("clears removed metadata so recreating the name starts fresh", () => {
    const removed = moveProfileAppearance({ Work: work, Personal: personal }, "Work", null);
    expect(removed).toEqual({ Personal: personal });
    expect(profileAppearance(removed, "Work")).toEqual(DEFAULT_PROFILE_APPEARANCE);
  });

  it("handles names that collide with object properties", () => {
    expect(profileAppearance({}, "constructor")).toEqual(DEFAULT_PROFILE_APPEARANCE);
    const renamed = moveProfileAppearance({ Work: work }, "Work", "__proto__");
    expect(profileAppearance(renamed, "__proto__")).toEqual(work);
    expect(profileAppearance(JSON.parse(JSON.stringify(renamed)), "__proto__")).toEqual(work);
    expect(moveProfileAppearance(renamed, "__proto__", null)).toEqual({});
  });

  it("carries the source mark when profiles are merged by a rename", () => {
    const stored: ProfileAppearances = { Work: work, Personal: personal };
    expect(moveProfileAppearance(stored, "Work", "Personal")).toEqual({ Personal: work });
  });
});
