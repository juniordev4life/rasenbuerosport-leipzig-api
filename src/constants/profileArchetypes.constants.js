/**
 * Player-profile base-archetype catalogue.
 *
 * Eight deterministic categories that the decision-tree maps the six
 * axis values onto. The labels here are the canonical German display
 * strings used by the UI; colors are Jersey-compatible accent
 * tokens; icons are short keys that the frontend resolves into actual
 * SVG glyphs (or emoji fallback for the mockup).
 *
 * Add new archetypes here AND add a matching branch to
 * `determineArchetype` — both must move together.
 */

/**
 * @typedef {object} ArchetypeMeta
 * @property {string} key - Internal identifier (lower-case, snake-case).
 * @property {string} label - German display label, e.g. "Der Vollstrecker".
 * @property {string} description - One-sentence summary for tooltips.
 * @property {string} color - Hex color used as accent for hero + spider tint.
 * @property {string} icon - Short icon key (frontend resolves to glyph).
 */

/** @type {Record<string, ArchetypeMeta>} */
export const ARCHETYPES = Object.freeze({
	vollstrecker: {
		key: "vollstrecker",
		label: "Der Vollstrecker",
		description: "Macht die Tore, wenn es zählt.",
		color: "#E24B4A",
		icon: "striker",
	},
	stratege: {
		key: "stratege",
		label: "Der Stratege",
		description: "Lenkt das Spiel mit Übersicht und Zuverlässigkeit.",
		color: "#378ADD",
		icon: "playmaker",
	},
	taktgeber: {
		key: "taktgeber",
		label: "Der Taktgeber",
		description: "Bestimmt den Rhythmus, hält das Team zusammen.",
		color: "#84CC16",
		icon: "metronome",
	},
	allrounder: {
		key: "allrounder",
		label: "Der Allrounder",
		description: "Solide in allen Disziplinen.",
		color: "#FBBF24",
		icon: "all-around",
	},
	hitzkopf: {
		key: "hitzkopf",
		label: "Der Hitzkopf",
		description: "Brillant offensiv, aber lebt am Disziplin-Limit.",
		color: "#F97316",
		icon: "fire",
	},
	zuverlaessige: {
		key: "zuverlaessige",
		label: "Der Zuverlässige",
		description: "Liefert konstant, ohne große Schwankungen.",
		color: "#A78BFA",
		icon: "shield",
	},
	carrier: {
		key: "carrier",
		label: "Der Carrier",
		description:
			"Macht seine Mitspieler besser, ohne im Rampenlicht zu stehen.",
		color: "#06B6D4",
		icon: "arm-flex",
	},
	spaetzuender: {
		key: "spaetzuender",
		label: "Der Spätzünder",
		description: "Wenn es brennt, dann brennt es richtig.",
		color: "#EC4899",
		icon: "clock-late",
	},
});

/** Convenience array of all known archetype keys. */
export const ARCHETYPE_KEYS = Object.freeze(Object.keys(ARCHETYPES));
