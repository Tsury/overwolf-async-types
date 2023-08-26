# overwolf-async-types

Async, typed real-time wrapper for the Overwolf API based on the [official type definitions](https://github.com/overwolf/types).

## Installation

To install, run:

```bash
npm install overwolf-async-types
```

Bear in mind that this will take a while as the new type definitions are generated upon installation.

## Usage

1. Add the types to your `tsconfig.json` file:

```json
{
  "compilerOptions": {
    "types": [
      "overwolf-async-types"
    ]
  }
}
```

2. Call the `promisify` method before using the Overwolf API:

```javascript
import { promisify } from 'overwolf-async-types';

promisify();
```

3. Consume the API using Promises:

```javascript
const res = await overwolf.windows.obtainDeclaredWindow('main');
```

4. (optional) Refetch and rebuild definitions:

```bash
npx generateOverwolfAsyncTypes
```

## How Does It Work

1. Fetches the latest d.ts files from Overwolf's repo
2. Iterates over the types inside `overwolf.d.ts` and updates them to use Promises, also updates JSDoc accordingly.
3. Generates promisify code into `promisify.js` - this code traverses the Overwolf API during runtime and wraps relevant functions in a Promise.

## Notes

- After installing/updating/rebuilding, restart your IDE/Typescript Server/ESLint Server to ensure you're working with the newly built definitions.
- To prevent conflicts, make sure to remove Overwolf's types library (`@overwolf/types`). If you want a solution that uses `@overwolf/types` instead of fetching the files, make a PR.
- Some Overwolf functions are readonly (e.g. `overwolf.io.dir`) - Those functions are kept intact, and new functions with an `Async` suffix are added (e.g. `overwolf.io.dirAsync`)
- Currently it seems that the official definitions file is not fully up-to-date with the actual API. If you find any discrepancies, open a PR on Overwolf's repo. I have contacted Overwolf and they are working on a way to generate the types out of their codebase to ensure coherence.
- This repo was created to serve my needs - it's not guaranteed to work for you OOTB. If you encounter any issues, don't hesitate to either open an issue or create a PR. 
- Currently I'm only traversing `overwolf.d.ts`, if you feel the need to traverse the other files, open an issue/PR.
