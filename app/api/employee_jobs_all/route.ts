import { NextRequest } from "next/server";

// Minimal valid Next.js Route Handler for /api/employee_jobs_all
export async function GET(request: NextRequest) {
	return new Response(JSON.stringify({ message: "Not implemented" }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
