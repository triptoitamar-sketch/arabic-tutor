// Firebase web config is not a secret — it's fine for this to be public in the
// deployed bundle. Access control lives in Firestore security rules instead
// (see firestore.rules). Replace these placeholder values with your real
// project's config (Firebase console → Project settings → Your apps → Web app).
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};
