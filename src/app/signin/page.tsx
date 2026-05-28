import { signIn } from "@/auth";
import { Button } from "@/components/ui/Button";
import { Github, Chrome } from "lucide-react";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-6 text-center">
        <h1 className="text-2xl font-bold">DocChat</h1>
        <p className="text-gray-600">Sign in to chat with your documents.</p>
        <form
          action={async () => {
            "use server";
            const { from } = await searchParams;
            await signIn("github", { redirectTo: from || "/" });
          }}
        >
          <Button type="submit" className="w-full">
            <Github size={18} />
            Continue with GitHub
          </Button>
        </form>
        <form
          action={async () => {
            "use server";
            const { from } = await searchParams;
            await signIn("google", { redirectTo: from || "/" });
          }}
        >
          <Button type="submit" className="w-full">
            <Chrome size={18} />
            Continue with Google
          </Button>
        </form>
      </div>
    </div>
  );
}
