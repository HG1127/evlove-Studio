import {defineEventHandler} from "nitro/h3";
import {getProductionBuildInfo} from "../../../src/services/build-info";

export default defineEventHandler(()=>getProductionBuildInfo());
