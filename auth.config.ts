import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth configuration for middleware.
 * MUST NOT import the database, bcrypt, or any Node-only module —
 * middleware runs in the edge runtime. Providers and DB-touching
 * callbacks live in auth.ts (Node runtime) and are merged in there.
 */
export default {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [], // populated in auth.ts
  callbacks: {
    authorized({ auth }) {
      return !!auth;
    },
  },
} satisfies NextAuthConfig;
