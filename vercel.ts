import { classroomVercelConfig } from "./deploy/vercel-routing.ts";

export const config = classroomVercelConfig(process.env);
