# ResearchDAO Contracts

## Contents

- `DisintermediatedGrants`: A contract to receive and handle ResearchDAO grants and donations. When the time comes for the governors to disperse the donated funds, they will do so by providing a grant proposal to the contract. The original donor then has the option to veto the grant and withdraw their funds. If they choose not to do so, the grant is automatically approved after a grace period has passed. This legally absolves the ResearchDAO of custodial responsibility, as the funds can be considered transferred from the donor to the beneficiary, directly. Any reporting responsibilities lie with the donor and the recipient.

## Installation & Testing

- Install dependencies: `npm i` 
- Run tests: `npm test`
