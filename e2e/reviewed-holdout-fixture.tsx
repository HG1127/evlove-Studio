import {createRoot} from "react-dom/client";
import {createElement} from "react";
import type {EvolveProject,ProductionRuntimePorts} from "@evolution/contracts";
import {configureProductionRuntime} from "../src/features/evolve/runtime/production-runtime";
import {ReviewedHoldoutPanel} from "../src/features/evolve/components/reviewed-holdout-panel";

/** Browser-only synthetic component harness. It never loads a real Mission, model or Artifact. */
export function mountReviewedHoldoutFixture(project:unknown){
  configureProductionRuntime({} as ProductionRuntimePorts,"http");
  const root=createRoot(document.getElementById("reviewed-fixture")!);
  root.render(createElement(ReviewedHoldoutPanel,{project:project as EvolveProject,busy:false}));
}

import "../src/index.css";
