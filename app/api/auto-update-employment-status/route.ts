import { NextRequest, NextResponse } from "next/server";

const MANUAL_ONLY_RESPONSE = {
	success: true,
	manual_only: true,
	updated_count: 0,
	total_probation_employees: 0,
	updated_employees: [],
	message:
		"Employment status auto-update is disabled. Update employment status manually from Add/Edit Employee.",
};

export async function GET(_req: NextRequest) {
	return NextResponse.json(MANUAL_ONLY_RESPONSE);
}

export async function POST(_req: NextRequest) {
	return NextResponse.json(MANUAL_ONLY_RESPONSE);
}
