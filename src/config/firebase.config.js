import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

let firebaseAuth = null;
let firebaseStorage = null;

function ensureApp() {
	if (!getApps().length) {
		const config = {
			projectId: process.env.FIREBASE_PROJECT_ID,
			storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
		};
		if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
			initializeApp();
		} else {
			initializeApp(config);
		}
	}
}

/**
 * Returns the Firebase Admin Auth singleton
 * @returns {import('firebase-admin/auth').Auth}
 */
export function getFirebaseAuth() {
	if (!firebaseAuth) {
		ensureApp();
		firebaseAuth = getAuth();
	}
	return firebaseAuth;
}

/**
 * Returns the default Firebase Storage bucket. The bucket name is read
 * from `FIREBASE_STORAGE_BUCKET` (e.g. `my-project.appspot.com`).
 *
 * @returns {import('@google-cloud/storage').Bucket}
 */
export function getStorageBucket() {
	if (!firebaseStorage) {
		ensureApp();
		const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
		firebaseStorage = bucketName
			? getStorage().bucket(bucketName)
			: getStorage().bucket();
	}
	return firebaseStorage;
}
