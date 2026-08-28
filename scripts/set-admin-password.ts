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
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { requireAdminPassword } from '../prisma/seed-admin-password';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  // Throws before touching the database if the value is missing or weak.
  const password = await hash(requireAdminPassword(), 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { password, role: UserRole.ADMIN },
    create: {
      email,
      name: 'Admin User',
      role: UserRole.ADMIN,
      password,
    },
  });

  console.log(`Admin password updated for ${admin.email}`);
}

main()
  .catch(error => {
    // The message, not the whole error: a Prisma error can carry the
    // connection string, and this script is run by hand with a terminal
    // full of scrollback.
    console.error(`Failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
