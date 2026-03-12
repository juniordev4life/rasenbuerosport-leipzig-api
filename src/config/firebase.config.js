import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let firebaseAuth = null;

/**
 * Returns the Firebase Admin Auth singleton
 * @returns {import('firebase-admin/auth').Auth}
 */
export function getFirebaseAuth() {
	if (!firebaseAuth) {
		if (!getApps().length) {
			if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
				initializeApp();
			} else {
				initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
			}
		}
		firebaseAuth = getAuth();
	}
	return firebaseAuth;
}
