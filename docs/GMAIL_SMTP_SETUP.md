# 📧 Professional Gmail Branding Setup

Follow these steps to change your email "From" name from "Supabase Auth" to **Pedicab Support**.

## Step 1: Create a Google "App Password"
Google requires a special 16-character code to let Supabase send emails through your account.

1.  Log in to your **App's Gmail account**.
2.  Go to [myaccount.google.com/security](https://myaccount.google.com/security).
3.  Ensure **2-Step Verification** is turned **ON**.
4.  Search for **"App Passwords"** in the top search bar and click it.
5.  Under "App name", type `Supabase` and click **Create**.
6.  **COPY the 16-character code** provided (e.g., `abcd efgh ijkl mnop`).

---

## Step 2: Configure Supabase
1.  Open your [Supabase Dashboard](https://app.supabase.com).
2.  Go to **Authentication** -> **SMTP Settings**.
3.  Switch **"Enable Custom SMTP"** to **ON**.
4.  Fill in these details:
    *   **Sender name**: `Pedicab Support`
    *   **Sender email**: (Your Gmail address)
    *   **SMTP Host**: `smtp.gmail.com`
    *   **SMTP Port**: `587`
    *   **SMTP User**: (Your Gmail address)
    *   **SMTP Password**: (The 16-character code from Step 1 - **remove spaces**)
5.  Click **Save**.

---

## Step 3: Verify
Trigger a "Forgot Password" or "Sign Up" email from your app. It should now arrive in the inbox showing your name and email address!
