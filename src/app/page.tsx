import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HomeClient from "./HomeClient";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/signin");
  return <HomeClient />;
}
