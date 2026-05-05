# LoyaltyVault — Firebase Setup Guide

## ✅ Migration Complete: Google Sheets → Firebase Firestore

Your project is now fully migrated to Firebase. Follow the steps below to complete the Firebase setup.

---

## STEP 1: Firebase Project (Already Created)

Your Firebase project details:
- **Project ID:** `loyalty-vault-dd624`
- **Auth Domain:** `loyalty-vault-dd624.firebaseapp.com`

---

## STEP 2: Enable Firebase Services

Go to [Firebase Console](https://console.firebase.google.com) → Your Project.

### Enable Firestore Database
1. Sidebar → **Firestore Database**
2. Click **Create database**
3. Choose **Production mode**
4. Select your region → Done

### Enable Authentication
1. Sidebar → **Authentication** → **Sign-in method**
2. Enable **Email/Password** provider → Save

---

## STEP 3: Create Owner Account

Owners cannot self-register — you must create them manually.

1. Go to **Authentication** → **Users** → **Add user**
2. Enter owner email & password
3. Copy the **User UID** shown in the table

Then go to **Firestore Database** → **Start collection**:
- Collection ID: `owners`
- Document ID: paste the **User UID**
- Add fields:
  - `name` → string → `Ankit Kumar Nayak`
  - `email` → string → owner email
  - `role` → string → `admin`
  - `createdAt` → timestamp → now

> ⚠️ Only users with a document in the `owners` collection can access the Owner Dashboard.

---

## STEP 4: Firestore Security Rules

Go to **Firestore Database** → **Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /billCodes/{doc} {
      allow read, write: if request.auth != null;
    }
    match /customers/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == resource.id || request.auth != null;
    }
    match /redemptionHistory/{doc} {
      allow read, write: if request.auth != null;
    }
    match /settings/{doc} {
      allow read, write: if request.auth != null;
    }
    match /owners/{doc} {
      allow read: if request.auth != null;
      allow write: if false; // only via console
    }
  }
}
```

Click **Publish**.

---

## STEP 5: Add Authorized Domain (for Vercel)

1. Go to **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain**
3. Add your Vercel URL: e.g. `loyalty-vault.vercel.app`

---

## STEP 6: Firestore Collection Structure

The app will auto-create these collections on first use:

| Collection | Purpose |
|-----------|---------|
| `billCodes` | All bill codes (UNUSED / REDEEMED) |
| `customers` | Registered customer profiles |
| `owners` | Owner accounts (manual setup only) |
| `redemptionHistory` | Audit log of all approved discounts |
| `settings` | App config (discounts, mode toggles) |

---

## STEP 7: Deploy to Vercel

```bash
# If using Vercel CLI
vercel --prod

# Or push to GitHub — Vercel auto-deploys
git add .
git commit -m "Migrate to Firebase"
git push
```

---

## HOW THE SYSTEM WORKS

### Owner Flow
1. Owner logs in with email/password
2. Goes to **Billing Codes** tab
3. Fills in: Bill Code, Customer Name, Phone, Amount, Date → **Add Bill Code**
4. When customer returns for discount → searches by phone/name/code
5. Clicks **Approve Discount** → confirmation popup → Status updated to REDEEMED instantly

### Customer Flow
1. Customer logs in simply by entering their **Name** and **Phone Number**.
2. Dashboard shows their **Profile** and **My Discounts** history.
3. Can also play **Bhagyada Chakram** (spin wheel) or **Malli Raa Baksheesh** (scratch card).

---

## FIREBASE CONFIG (Already in index.html)

```js
const firebaseConfig = {
  apiKey: "AIzaSyAfSOLSVLOFULHnFOEl-zv1k08-jkWfFEk",
  authDomain: "loyalty-vault-dd624.firebaseapp.com",
  projectId: "loyalty-vault-dd624",
  storageBucket: "loyalty-vault-dd624.firebasestorage.app",
  messagingSenderId: "119743895215",
  appId: "1:119743895215:web:29f2af43d25645ac78265a"
};
```

---

## TROUBLESHOOTING

| Error | Fix |
|-------|-----|
| `firebase is not defined` | Make sure compat CDN scripts load before app.js |
| `Missing permissions` | Check Firestore Rules are published |
| `Owner access denied` | Make sure UID exists in `owners` collection |
| `Auth domain not authorized` | Add Vercel URL to Firebase Auth authorized domains |
| Customer can't login | Ensure phone is 10 digits and name is >1 char (no email/pass needed) |
