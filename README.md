# Andhra Hotel - Loyalty Vault

A modern web application designed for **Andhra Hotel** to manage customer loyalty, issue digital discount coupons, and track bill codes (KOTs). This document explains the complete flow, business logic, and security measures in simple terms.

---

## 📖 System Overview

The website is divided into two main sections:
1. **The Customer View**: Where customers log in to play a digital scratch card or spin-the-wheel game to win discounts on their next meal.
2. **The Owner Dashboard**: A secure portal where the restaurant owner manages bill codes, verifies coupons, and controls the system's settings.

---

## ⚙️ How the Flow Works (Step-by-Step)

### 1. Generating a Bill Code (Owner Side)
When a customer finishes their meal, the restaurant owner wants to give them a chance to win a discount for their *next* visit.
* The owner logs into the Owner Dashboard.
* In the **Add New Bill Code** section, the owner enters the **KOT Number** (Kitchen Order Ticket, e.g., `72`), the **Customer's Phone Number**, and the **Bill Amount**.
* **The Date Magic (Auto-Append Logic)**: Behind the scenes, the system looks at today's date (for example, May 6, 2026 translates to `06052026`). It automatically attaches this date to the KOT number. So, while the owner only typed `72`, the database securely saves it as `7206052026`. This ensures that if another order `#72` happens next month, the codes will never clash.

### 2. Customer Login & Verification (Customer Side)
The customer visits the website on their phone to play the game.
* They enter their **Name**, **Phone Number**, and the **KOT Number** (`72`) printed on their receipt.
* The system automatically takes the `72` they typed, appends today's date (`06052026`), and searches the database for `7206052026`.
* *(Backward Compatibility)*: If it cannot find the date-appended code (for example, if the KOT was created before the date feature was added), it falls back and searches for just the raw `72`.
* **Security Checks**: 
  1. The phone number the customer entered MUST match the phone number the owner attached to that KOT. If they don't match, access is denied.
  2. The KOT must not have been used to play a game already.

### 3. The 10-Day Cooldown System
To prevent abuse, the system enforces a strict 10-day cooldown period per customer.
* When the customer logs in, the system checks their history based on their phone number.
* If their most recent game play was less than 10 days ago, the system checks if they have **redeemed** that previous discount.
* **If UNUSED**: They are blocked from playing again. The system tells them to use their existing discount first or wait out the 10 days.
* **If REDEEMED**: If the owner has already approved/redeemed their previous discount, the cooldown is instantly bypassed! The customer is immediately allowed to play again with their new KOT.

### 4. Winning and Claiming the Discount
* Once allowed in, the customer plays the game (either the Scratch Card or the Spin Wheel, depending on what the owner activated in the settings).
* They win a discount (e.g., 5%, 10%, or 15% OFF).
* The KOT status in the database is marked as `hasPlayed = true`, meaning this specific KOT is burned and can never be used to access the game again.
* The customer is presented with a beautiful digital coupon showing the discount, their name, and an Expiry Date. They can download this coupon as an image to show the cashier on their next visit.

### 5. Redeeming the Coupon (Owner Side)
* On the customer's next visit, they show the downloaded coupon (or simply provide their phone number) to the cashier.
* The owner logs into the Dashboard and searches for the customer's phone number or the original KOT number in the **Redeem / Verify Coupon** section.
* The owner clicks **Approve**.
* The discount status changes from `UNUSED` to `REDEEMED`.
* Because it is now redeemed, the customer's 10-day cooldown is lifted, and they are free to play the game again when they get their new bill!

### 6. Data Management & Security
* **Firebase Firestore**: The application uses Google's Firebase Firestore to store data securely in the cloud in real-time.
* **Erase All Data**: The owner has a secure "Erase All Data" button in the Settings tab to wipe the system clean. To prevent accidental clicks or unauthorized access, it strictly requires the owner to re-enter their admin email and password. Once authenticated, it safely wipes all customers, bill codes, and redemption history from the database, starting entirely fresh.
