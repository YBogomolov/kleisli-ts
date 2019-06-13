# Kleisli arrows for bifunctor IO

[![npm](https://img.shields.io/npm/v/kleisli-ts.svg)](https://www.npmjs.com/package/kleisli-ts)
[![Build Status](https://travis-ci.org/YBogomolov/kleisli-ts.svg)](https://travis-ci.org/YBogomolov/kleisli-ts)

TypeScript port of `KleisliIO` – Kleisli arrows with bifunctor IO from great talk by [John A. De Goes](https://github.com/jdegoes) at LambdaConf'18 called ["Blazing Fast, Pure Effects without Monads"](https://www.youtube.com/watch?v=L8AEj6IRNEE).

Please see [examples](./examples) for posible ways of programming with Kleisli arrows.

### Simple example

```ts
import { ioEither, URI as IOEitherURI } from 'fp-ts/lib/IOEither';

import { impureVoid, KleisliIO, liftK } from 'kleisli-ts/lib';
import { unsafeRunIE } from 'kleisli-ts/lib/unsafe';

const app: KleisliIO<IOEitherURI, Error, void, string> = 
  liftK(ioEither)(() => {
    if (Math.random() > 0.5) {
      throw new Error('oops');
    }
    return 'foo';
  });

const log: KleisliIO<IOEitherURI, never, string, void> = 
  impureVoid(ioEither)((s) => console.log(s));

unsafeRunIE(app.andThen(log).run());
```