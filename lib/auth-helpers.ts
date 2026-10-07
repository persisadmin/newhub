import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import { getDb, ensureIndexes } from "./db";
import { HttpError } from "./api";
import { isMaintenanceMode } from "./services/maintenance";
import type { ProjectDoc, Role } from "./domain/types";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Require an authenticated session; throws HttpError(401) otherwise.
 *  During maintenance mode, non-admins are blocked with 503 — this halts
 *  existing sessions' API calls, not just new sign-ins. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Authentication required", "UNAUTHENTICATED");
  const role = ((session.user as { role?: Role }).role ?? "contractor") as Role;
  if (role !== "admin" && (await isMaintenanceMode())) {
    throw new HttpError(503, "PERSIS is temporarily down for maintenance. Please try again shortly.", "MAINTENANCE");
  }
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role,
  };
}

export function requireRole(user: SessionUser, ...roles: Role[]) {
  if (!roles.includes(user.role)) throw new HttpError(403, "Insufficient permissions", "FORBIDDEN");
}

/** Load a project and enforce ownership (admins bypass). */
export async function requireOwnedProject(projectId: string, user: SessionUser): Promise<ProjectDoc> {
  if (!ObjectId.isValid(projectId)) throw new HttpError(404, "Project not found", "NOT_FOUND");
  await ensureIndexes();
  const db = await getDb();
  const project = await db.collection<ProjectDoc>("projects").findOne({ _id: new ObjectId(projectId) });
  if (!project) throw new HttpError(404, "Project not found", "NOT_FOUND");
  if (user.role !== "admin" && String(project.userId) !== user.id) {
    throw new HttpError(403, "You do not have access to this project", "FORBIDDEN");
  }
  return project;
}
