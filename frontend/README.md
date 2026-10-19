# PassGram Mini App

Telegram Mini App built with Next.js, TypeScript, and Tailwind CSS.

The app uses one account that can subscribe, create communities, and join the referral program. The bottom navigation is Dashboard, Create, and Referral. My Account opens from the profile button.

Payments, community creation, bot permissions, referral attribution, and the leaderboard stay unconfirmed until the PassGram contract, indexer, and bot are connected. A prepared or submitted wallet transaction is not treated as success.

## Run

```bash
cd frontend
npm install
npm run dev
npm test
```

Open `http://localhost:3000`.

Community links use `/?community=123`. Referral links use `/?ref=code`. Telegram start parameters accept `c_123`, `ref_code`, and `c_123_ref_code`.
