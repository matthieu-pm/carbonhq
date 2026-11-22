"use client";

import { DesignPreview } from "../_shared/DesignPreview";
import { BASE, click, type, useScene, type Scene, type Step } from "../_shared/scene";

/// The button's radius and fill are bound to tokens here, so a token edit
/// repaints the art, the chip and the button together.
const START: Scene = { ...BASE, buttonRadius: null, buttonFill: "brand", selected: "art" };

const STEPS: Step[] = [
  { hold: 1100, set: { target: null } },
  ...click("mode-Theme", { mode: "Theme" }),
  ...click("token-brand", { tokenEdit: "brand" }),
  ...click("token-value", { field: "token-value", fieldText: "#4f5bff" }),
  { hold: 320, set: { fieldText: "" } },
  ...type("#ef5a3c", "fieldText", 110),
  { hold: 600, set: { field: null, brand: "#ef5a3c", saving: "saving" } },
  { hold: 900, set: { saving: "saved" } },
  ...click("token-rounded.lg", { tokenEdit: "rounded.lg" }),
  ...click("radius-28", { radiusToken: 28, saving: "saving" }),
  { hold: 700, set: { saving: "saved" } },
  { hold: 3400, set: { target: null } },
];

export function FieldnotesPreview() {
  const ctl = useScene(START, STEPS);
  return <DesignPreview ctl={ctl} compactPanel="theme" file="welcome" />;
}
