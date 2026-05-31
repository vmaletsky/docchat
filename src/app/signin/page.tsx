import { signIn } from "@/auth";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Github, Chrome } from "lucide-react";
import Link from "next/link";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-6 text-center">
        <h1 className="text-2xl font-bold">DocChat</h1>
        <p className="text-gray-600">Sign in to chat with your documents.</p>

        {error === "CredentialsSignin" && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            Incorrect email or password.
          </p>
        )}

        <form
          className="flex flex-col gap-3 text-left"
          action={async (formData: FormData) => {
            "use server";
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: from || "/",
            });
          }}
        >
          <TextInput
            name="email"
            type="email"
            placeholder="Email"
            required
            autoComplete="email"
            className="w-full"
          />
          <TextInput
            name="password"
            type="password"
            placeholder="Password"
            required
            autoComplete="current-password"
            className="w-full"
          />
          <Button type="submit" className="w-full">
            Sign in with email
          </Button>
        </form>

        <p className="text-sm text-gray-500">
          No account?{" "}
          <Link href="/register" className="text-blue-600 hover:underline">
            Create one
          </Link>
        </p>

        <div className="flex items-center gap-3">
          <hr className="flex-1 border-gray-200" />
          <span className="text-xs text-gray-400">or continue with</span>
          <hr className="flex-1 border-gray-200" />
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: from || "/" });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full">
            <Github size={18} />
            GitHub
          </Button>
        </form>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: from || "/" });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full">
            <Chrome size={18} />
            Google
          </Button>
        </form>
      </div>
    </div>
  );
}
