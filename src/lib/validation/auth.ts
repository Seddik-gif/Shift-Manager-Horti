import { z } from "zod";

/** Messages are i18n keys under "validation" – translated where they are displayed. */
export const loginSchema = z.object({
  email: z.string().trim().min(1, "required").pipe(z.email("email")),
  password: z.string().min(1, "required"),
});

export const setPasswordSchema = z
  .object({
    password: z.string().min(10, "passwordLength"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "passwordMismatch" });

export type LoginInput = z.infer<typeof loginSchema>;
