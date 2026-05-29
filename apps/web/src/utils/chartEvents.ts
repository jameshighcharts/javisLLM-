import type Highcharts from "highcharts";

export const BENCHMARK_EVENT_PLOT_LINES: Highcharts.XAxisPlotLinesOptions[] = [
	{
		value: Date.UTC(2026, 4, 28, 12, 0, 0, 0),
		color: "#B8643C",
		width: 2,
		dashStyle: "ShortDash",
		zIndex: 4,
		label: {
			text: "React prompts added",
			align: "left",
			rotation: 0,
			x: 8,
			y: 12,
			style: {
				color: "#8B4A2F",
				fontSize: "11px",
				fontWeight: "600",
				textOutline: "none",
			},
		},
	},
];
