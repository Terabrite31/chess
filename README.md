# Chess

A browser chess board with Vercel serverless multiplayer.

## Multiplayer

Click **Create room**, then **Copy link** and send that link to the other player. The first browser is White and the invited browser joins as Black. Moves are validated by `/api/games` and synced with short polling.

For production persistence, add Vercel KV to the project so these environment variables exist:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Without KV, the API falls back to in-memory storage, which is useful for local testing but can reset when a Vercel serverless function instance is replaced.
