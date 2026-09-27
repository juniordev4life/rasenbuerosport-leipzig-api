/**
 * The season awards in German, for the AI prompts: `name` matches the app's
 * season_awards.*.label, `misst` says what the award's value counts
 * (see buildSeasonAwards). Without it a model reads "unlucky: 100 games"
 * as a hundred defeats and translates award keys freely.
 */
export const SEASON_AWARDS_DE = Object.freeze({
	champion: { name: "Meister", misst: "ELO-Endstand" },
	top_scorer: { name: "Torschützenkönig", misst: "Tore" },
	top_assister: { name: "Vorlagenkönig", misst: "Vorlagen" },
	dream_duo: { name: "Dream-Duo", misst: "gemeinsames Duo-ELO zum Saisonende" },
	penalty_king: {
		name: "Elfmeterkönig",
		misst:
			"Punkte im Elfmeterschießen: verwandelte Elfmeter plus nicht verwandelte Schüsse des Gegners, während er im Tor stand",
	},
	fair_play: {
		name: "Fairplay-Preis",
		misst: "Karten pro Spiel (Rot zählt dreifach), die wenigsten gewinnen",
	},
	wall: {
		name: "Die Mauer",
		misst: "Gegentore pro Spiel, die wenigsten gewinnen",
	},
	marathon: { name: "Dauerbrenner", misst: "Spiele" },
	form_of_the_year: {
		name: "Form der Saison",
		misst: "ELO-Zuwachs in den letzten acht Wochen der Saison",
	},
	lunch_king: {
		name: "Mittagspausen-König",
		misst: "Spiele zwischen 12 und 14 Uhr",
	},
	comeback_king: { name: "Comeback-König", misst: "Siege nach Rückstand" },
	unlucky: {
		name: "Pechvogel",
		misst: "Niederlagen mit einem Tor Unterschied",
	},
});
