// scripts/set-admin-password.ts
//
// Sets (or resets) the admin account's password from ADMIN_PASSWORD.
//
// Exists because `npm run db:seed` is not re-runnable -- it dies partway
// through on a unique constraint once the catalogue is already there
// (finding 27). Re-seeding a live database to change one password would
// mean deliberately running a script that is known to crash, and hoping
// it crashes late enough. This touches one row and nothing else.
//
// The password is read from the environment and never printed. Run it
// yourself with the value set; nobody else needs to see it.
//
//   ADMIN_PASSWORD='...' npm run admin:password
import { loadEnvConfig } from '@next/env';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { requireAdminPassword } from '../prisma/seed-admin-password';

// Prisma only auto-loads `.env`, and this project keeps its configuration
// in `.env.local` -- without this the script finds no DATABASE_URL and
// fails for a reason that has nothing to do with what it is doing.
// Anything already set in the real environment wins, so an inline
// ADMIN_PASSWORD on the command line still overrides the file.
loadEnvConfig(process.cwd());

type AdminWriter = {
  user: {
    // `any` on the argument and PromiseLike on the result are both
    // deliberate: Prisma's upsert is generic over its own argument type
    // and returns its own thenable, so anything narrower here makes the
    // real client unassignable to this parameter.
    upsert: (args: any) => PromiseLike<{ email: string }>;
  };
};

/**
 * Separated from the script body so the write can be tested without a
 * database -- and without briefly creating a real ADMIN account somewhere
 * just to prove the upsert is shaped correctly.
 */
export async function setAdminPassword(
  db: AdminWriter,
  email: string,
  plainPassword: string
): Promise<{ email: string }> {
  const password = await hash(plainPassword, 12);

  return db.user.upsert({
    where: { email },
    // The role is written alongside the password: an admin account that
    // somehow lost its role should come back as an admin, not as a
    // customer who happens to know the password.
    update: { password, role: UserRole.ADMIN },
    create: {
      email,
      name: 'Admin User',
      role: UserRole.ADMIN,
      password,
    },
  });
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    // Throws before the database is touched if the value is missing or weak.
    const plainPassword = requireAdminPassword();

    const admin = await setAdminPassword(prisma, email, plainPassword);

    console.log(`Admin password updated for ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only when run as a script -- importing this module for its exports must
// not connect to anything.
if (require.main === module) {
  main().catch(error => {
    // The message, not the whole error: a Prisma error can carry the
    // connection string, and this is run by hand with a terminal full of
    // scrollback.
    console.error(`Failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
