export const ROW_HEIGHT = 28
export const LANE_WIDTH = 14

// Mid-tone, reasonably distinct, readable on both light and dark backgrounds.
export const BRANCH_PALETTE = [
	"#3b82f6",
	"#22c55e",
	"#f59e0b",
	"#ef4444",
	"#a855f7",
	"#06b6d4",
	"#ec4899",
	"#84cc16",
]

export function laneColor(index: number): string {
	return BRANCH_PALETTE[index % BRANCH_PALETTE.length]
}
