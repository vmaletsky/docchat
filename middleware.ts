import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/signin", "/register", "/api/auth", "/api/register"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!req.auth && !isPublic) {
    const signinUrl = new URL("/signin", req.nextUrl.origin);
    if (pathname !== "/") signinUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(signinUrl);
  }

  if (req.auth && (pathname === "/signin" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
