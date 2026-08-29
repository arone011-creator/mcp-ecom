// File: app/access-denied/page.tsx
import { Metadata } from 'next';
import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Access Denied',
  description: 'You do not have permission to view this page.',
};

// The middleware has redirected here for admin routes since the repository
// was published, but the page itself was never written -- so a permission
// denial rendered as a 404. Two integration tests already assert this
// redirect target, so the page is the fix rather than the redirect.
export default function AccessDeniedPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <ShieldX className="mb-4 h-16 w-16 text-muted-foreground" />
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        Access denied
      </h1>
      <p className="mb-6 text-muted-foreground">
        Your account does not have permission to view this page.
      </p>
      <Button asChild>
        <Link href="/">Back to store</Link>
      </Button>
    </div>
  );
}
