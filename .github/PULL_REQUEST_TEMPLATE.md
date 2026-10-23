## Summary

<!-- What changed, and why. One to three sentences. -->

## Test plan

- [ ] `contract`: `npm run build` and `npm test` if the contract or its tests changed
- [ ] `bot-service`: `npm test` if the indexer, cron, or its tests changed
- [ ] `frontend`: `npm test` and `npm run build` if the Mini App, an API, or shared types changed
- [ ] No secrets, mnemonics, or live tokens are in the diff

## Contract and data

- [ ] This pull request does not deploy a contract or change a production address
- [ ] A new SQL change is a new file in `backend/migrations/`, and `backend/schema.sql` matches it
- [ ] A code-hash change is called out here, including the new `contract/registry.codehash`
