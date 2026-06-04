import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/Button";
import { LogOut } from "lucide-react";

export async function Header() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b">
      <span className="font-semibold">DocChat</span>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-600">
          {session.user.email ?? session.user.name}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
            <LogOut size={14} />
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
