import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { firebaseConfig } from '../config/firebaseConfig.js';
import { FIRESTORE_COLLECTION, FIRESTORE_DOC_ID } from '../config/constants.js';

let db = null;

function getDb() {
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Returns the last saved lesson summary, or null if there isn't one / the read fails. */
export async function getLatestSummary() {
  try {
    const ref = doc(getDb(), FIRESTORE_COLLECTION, FIRESTORE_DOC_ID);
    const snap = await withTimeout(getDoc(ref), 5000);
    if (!snap.exists()) return null;
    const data = snap.data();
    return typeof data.summary === 'string' ? data.summary : null;
  } catch (err) {
    console.warn('getLatestSummary failed, starting without prior context:', err);
    return null;
  }
}

/** Best-effort save — failure here must never block ending the lesson. */
export async function saveSummary(summaryText) {
  try {
    const ref = doc(getDb(), FIRESTORE_COLLECTION, FIRESTORE_DOC_ID);
    const prev = await withTimeout(getDoc(ref), 5000).catch(() => null);
    const prevCount = prev && prev.exists() ? prev.data().lessonCount || 0 : 0;
    await withTimeout(
      setDoc(ref, {
        summary: summaryText,
        updatedAt: serverTimestamp(),
        lessonCount: prevCount + 1,
      }),
      5000,
    );
    return true;
  } catch (err) {
    console.warn('saveSummary failed:', err);
    return false;
  }
}
