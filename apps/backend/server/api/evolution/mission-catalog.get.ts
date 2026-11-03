import {defineEventHandler,setResponseHeader} from "nitro/h3";
import {getServerMissionCatalog} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";
export default defineEventHandler(async event=>{
 await requireGovernedEvolutionPermission(event,"data.read");requireServerDataPlaneAvailable();
 setResponseHeader(event,"Cache-Control","no-store");return getServerMissionCatalog();
});
