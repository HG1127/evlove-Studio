import {z} from "zod";

export const ReadIdentitySchema=z.string().trim().min(1).max(200);

export const MissionReadQuerySchema=z.object({missionId:ReadIdentitySchema});
export const JobReadQuerySchema=z.object({id:ReadIdentitySchema});
