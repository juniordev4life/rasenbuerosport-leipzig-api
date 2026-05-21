/**
 * Central tuning constants for the contribution-weighted ELO system.
 *
 * Every value here is a deliberate calibration of the spec — change
 * one number and bump the snapshot `version` so historic match rows
 * remain traceable to the constants they were computed with. The
 * tuning table in DEPLOY_PROD.md (or the feature spec) explains which
 * symptom maps to which knob.
 *
 * Rule of thumb: don't change these in this file without also bumping
 * `ELO_ALGORITHM_VERSION` and adding a row to the release notes.
 */

/**
 * @typedef {object} EloConstants
 * @property {number} startingRating Start-ELO für neue Spieler
 * @property {number} kFactor Standard-K-Faktor
 * @property {number} kFactorNewPlayer K-Faktor für Spieler mit < newPlayerThreshold Spielen
 * @property {number} newPlayerThreshold Spielanzahl, ab der kFactor (statt kFactorNewPlayer) gilt
 * @property {number} goalWeight Contribution-Gewicht pro Tor
 * @property {number} assistWeight Contribution-Gewicht pro Vorlage
 * @property {number} redCardPenalty Contribution-Malus pro Rote Karte (vor Zeitfaktor)
 * @property {number} participationBaseline Mindest-Contribution pro Spieler
 * @property {number} shareMin Untere Grenze für individuellen Share
 * @property {number} shareMax Obere Grenze für individuellen Share
 */

/** @type {EloConstants} */
export const ELO_CONSTANTS = Object.freeze({
	startingRating: 1500,
	kFactor: 32,
	kFactorNewPlayer: 48,
	newPlayerThreshold: 30,
	goalWeight: 1.0,
	assistWeight: 0.5,
	redCardPenalty: 2.0,
	participationBaseline: 1.0,
	shareMin: 0.2,
	shareMax: 0.8,
});

/**
 * Snapshot version stamped onto every match-elo record. Bump on any
 * change to the constants above or to the algorithm in
 * `src/api/services/elo/*` so historical rows stay traceable.
 */
export const ELO_ALGORITHM_VERSION = "v1.0";
