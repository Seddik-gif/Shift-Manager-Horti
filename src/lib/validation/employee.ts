import { z } from "zod";

const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;

/** Messages are i18n keys under "validation". */
export const employeeSchema = z.object({
  firstName: z.string().trim().min(1, "required").max(60, "tooLong"),
  lastName: z.string().trim().min(1, "required").max(60, "tooLong"),
  email: z.string().trim().min(1, "required").max(254, "tooLong").pipe(z.email("email")),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || PHONE_RE.test(v), "phoneInvalid"),
  jobPosition: z.string().trim().max(60, "tooLong"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "colorInvalid"),
  preferredLanguage: z.enum(["it", "en"]),
});

/** Email belongs to the login account and is not editable after creation. */
export const employeeUpdateSchema = employeeSchema.omit({ email: true });

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
