import { NextResponse } from "next/server";

// Статический экспорт (BUILD_STATIC=1): маршрут-заглушка без динамики.
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}