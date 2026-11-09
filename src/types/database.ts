// Hand-written row types for the tables used so far. Replace with
// `supabase gen types typescript` output once a project is linked.
export type UserRole = "admin" | "employee";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  job_position: string | null;
  color: string;
  is_active: boolean;
  role: UserRole;
  preferred_language: "it" | "en";
  created_at: string;
}
