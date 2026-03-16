const seasonQuerystring = {
	type: "object",
	properties: {
		season: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
	},
};

export const getDashboardStatsSchema = {
	querystring: seasonQuerystring,
};

export const getCommunityStatsSchema = {
	querystring: seasonQuerystring,
};
