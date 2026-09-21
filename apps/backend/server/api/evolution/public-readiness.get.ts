import {defineEventHandler} from "nitro/h3";
import {getPublicReadinessSnapshot} from "../../../src/services/public-readiness";

export default defineEventHandler(()=>getPublicReadinessSnapshot());
