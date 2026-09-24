import {defineEventHandler} from "nitro/h3";
import registerArtifact from "./artifacts/register.post";

// Preserve the legacy JSON URL while sharing the bounded, immutable registration path.
export default defineEventHandler((event)=>registerArtifact(event));
