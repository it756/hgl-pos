import { z } from "zod";

export const StaffRoleSchema = z.enum(["store_manager", "hq_admin"]);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

const scoped = <T extends { role: StaffRole; store_id: string | null }>(value: T, ctx: z.RefinementCtx) => {
  if (value.role === "hq_admin" && value.store_id !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HQ admins are not assigned to a store.", path: ["store_id"] });
  }
  if (value.role === "store_manager" && value.store_id === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Store managers must be assigned to a store.", path: ["store_id"] });
  }
};

export const InviteStaffSchema = z
  .object({
    full_name: z.string().trim().min(1, "Name is required").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email"),
    role: StaffRoleSchema,
    store_id: z.string().uuid().nullable(),
    password: z.string().min(12, "Temporary password must be at least 12 characters").max(72),
    pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits"),
  })
  .superRefine(scoped);
export type InviteStaffInput = z.infer<typeof InviteStaffSchema>;

export const UpdateStaffSchema = z
  .object({
    user_id: z.string().uuid(),
    full_name: z.string().trim().min(1, "Name is required").max(120),
    role: StaffRoleSchema,
    store_id: z.string().uuid().nullable(),
  })
  .superRefine(scoped);
export type UpdateStaffInput = z.infer<typeof UpdateStaffSchema>;