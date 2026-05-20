# Chess

A browser chess board with Vercel serverless multiplayer.

## Multiplayer

Click **Create room**, then **Copy link** and send that link to the other player. The first browser is White and the invited browser joins as Black. Moves are validated by `/api/games` and synced with short polling.

For production persistence, add Vercel KV to the project so these environment variables exist:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Without KV, the API falls back to in-memory storage, which is useful for local testing but can reset when a Vercel serverless function instance is replaced.

## Accounts

Online rooms require a verified account. Registration sends a verification email through Resend when these environment variables exist:

- `AUTH_SECRET`: a long random secret used for stable account ids and cookies
- `APP_URL`: the deployed site URL, for example `https://your-app.vercel.app`
- `RESEND_API_KEY`: your Resend API key
- `EMAIL_FROM`: the verified sender, for example `Chess <verify@yourdomain.com>`

If `RESEND_API_KEY` is missing, registration uses dev mode and returns the verification link in the app instead of sending email.
