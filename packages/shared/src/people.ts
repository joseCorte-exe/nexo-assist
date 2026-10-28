import { z } from "zod";
import { analystLevel } from "./domain";

export const employeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  department: z.string(),
  passwordChangedAt: z.iso.datetime().nullable(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const analystSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  level: analystLevel,
  available: z.boolean(),
});
export type Analyst = z.infer<typeof analystSchema>;
