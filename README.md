# Kleisli arrows for bifunctor IO

[![npm](https://img.shields.io/npm/v/kleisli-ts.svg)](https://www.npmjs.com/package/kleisli-ts)
[![Build Status](https://travis-ci.org/YBogomolov/kleisli-ts.svg)](https://travis-ci.org/YBogomolov/kleisli-ts)

Part of [fp-ts](https://github.com/gcanti/fp-ts) ecosystem.

TypeScript port of `KleisliIO` – Kleisli arrows with bifunctor IO from great talk by [John A. De Goes](https://github.com/jdegoes) at LambdaConf'18 called ["Blazing Fast, Pure Effects without Monads"](https://www.youtube.com/watch?v=L8AEj6IRNEE).

Please see [examples](./examples) for posible ways of programming with Kleisli arrows.

## Installation & usage

1. Install this module either via NPM or Yarn:
    ```sh
    npm i kleisli-ts
    # or
    yarn add kleisli-ts
    ```
2. This module has a peer dependency – [fp-ts](https://github.com/gcanti/fp-ts), so you'll need to install it as well:
    ```sh
    npm i fp-ts@1
    yarn add fp-ts@1
    ```
3. `kleisli-ts` provides curried functions as its main API, but you also have a convenience method `getInstancesFor`, which returns an API instance bound to the given monad:
    ```ts
    import { getInstancesFor } from 'kleisli-ts';
    import { ioEither } from 'fp-ts/lib/IOEither';

    const { liftK } = getInstancesFor(ioEither);

    const throwMe = liftK(() => { throw new Error('yay, it works'); });
    ```

## Simple example

```ts
import { ioEither, URI as IOEitherURI } from 'fp-ts/lib/IOEither';

import { getInstancesFor, KleisliIO } from 'kleisli-ts/lib';
import { unsafeRunIE } from 'kleisli-ts/lib/unsafe';

const { impureVoid, liftK } = getInstancesFor(ioEither);

const k: KleisliIO<IOEitherURI, Error, void, string> = liftK(() => {
  if (Math.random() > 0.5) {
    throw new Error('oops');
  }
  return 'foo';
});
const log: KleisliIO<IOEitherURI, never, string, void> = impureVoid((s) => console.log(s));

unsafeRunIE(k.andThen(log).run());
```