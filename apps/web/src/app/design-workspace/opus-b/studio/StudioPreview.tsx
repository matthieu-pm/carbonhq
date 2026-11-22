"use client";

import { DesignPreview } from "../_shared/DesignPreview";
import { BASE, click, type, useScene, type Step } from "../_shared/scene";

/// Select a layer, change a property in the inspector, bind its fill to a
/// token, and watch autosave. The last step is the finished picture.
const STEPS: Step[] = [
  { hold: 1100, set: { target: null } },
  ...click("layer-button", { selected: "button" }),
  ...click("radius-field", { field: "radius", fieldText: "4" }),
  { hold: 260, set: { fieldText: "" } },
  ...type("24", "fieldText", 180),
  { hold: 450, set: { field: null, buttonRadius: 24, saving: "saving" } },
  { hold: 500, set: { saving: "saved" } },
  ...click("fill-row", { tokenMenu: true }),
  ...click("menu-brand", { buttonFill: "brand", tokenMenu: false, saving: "saving" }, 550),
  { hold: 600, set: { saving: "saved" } },
  { hold: 3200, set: { target: null } },
];

export function StudioPreview() {
  const ctl = useScene(BASE, STEPS);
  return <DesignPreview ctl={ctl} story="Select the button, set its radius, bind its fill to brand" compactPanel="inspector" />;
}
