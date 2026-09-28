import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { isMaintenanceMode } from "@/lib/services/maintenance";
import { applySignupPromo } from "@/lib/services/promo";
import authConfig from "@/auth.config";
import type { UserDoc } from "@/lib/domain/types";

const env = getEnv();

const providers = [
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? [Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })]
    : []),
  Credentials({
    name: "Email & Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = String(credentials?.email ?? "").toLowerCase().trim();
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      await ensureIndexes();
      const db = await getDb();
      const user = await db.collection<UserDoc>("users").findOne({ email });
      if (!user?.passwordHash) return null;
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;
      return { id: String(user._id), email: user.email, name: user.name, image: user.image, role: user.role };
    },
  }),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: env.NEXTAUTH_SECRET,
  providers,
  callbacks: {
    async signIn({ user }) {
      // Upsert OAuth users into our own users collection (role: contractor by default).
      if (!user.email) return false;
      await ensureIndexes();
      const db = await getDb();
      const email = user.email.toLowerCase();
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const isAdmin = adminEmails.includes(email);
      const existing = await db.collection<UserDoc>("users").findOne({ email });
      // Maintenance mode: only admins may sign in.
      if (await isMaintenanceMode()) {
        const role = existing?.role ?? (isAdmin ? "admin" : "contractor");
        if (!isAdmin && role !== "admin") return false;
      }
      if (!existing) {
        const now = new Date();
        const res = await db.collection<UserDoc>("users").insertOne({
          email,
          name: user.name ?? email.split("@")[0],
          image: user.image ?? undefined,
          role: isAdmin ? "admin" : "contractor",
          createdAt: now,
          updatedAt: now,
        } as UserDoc);
        user.id = String(res.insertedId);
        await audit({
          userId: res.insertedId,
          action: "user.registered",
          entityType: "user",
          entityId: res.insertedId,
          newValue: { email, via: "oauth", role: isAdmin ? "admin" : "contractor" },
          source: "auth",
        });
        await applySignupPromo(res.insertedId, email);
      } else {
        user.id = String(existing._id);
        // Promote to admin if listed in ADMIN_EMAILS (e.g. first deployment).
        if (isAdmin && existing.role !== "admin") {
          await db.collection<UserDoc>("users").updateOne(
            { _id: existing._id },
            { $set: { role: "admin", updatedAt: new Date() } }
          );
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        const db = await getDb();
        const doc = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(String(user.id)) });
        token.role = doc?.role ?? "contractor";
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = String(token.uid);
        (session.user as { role?: string }).role = String(token.role ?? "contractor");
      }
      return session;
    },
  },
});
