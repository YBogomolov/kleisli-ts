import { ioEither, URI as IOEitherURI } from 'fp-ts/lib/IOEither';

import { impureVoid, KleisliIO, liftK } from '../src';
import { unsafeRunIE } from '../src/unsafe';

const k: KleisliIO<IOEitherURI, Error, void, string> = liftK(ioEither)(() => {
  if (Math.random() > 0.5) {
    throw new Error('oops');
  }
  return 'foo';
});
const log: KleisliIO<IOEitherURI, never, string, void> = impureVoid(ioEither)((s) => console.log(s));

unsafeRunIE(k.andThen(log).run()); // 🤞🏻 hope it doesn't blow up and prints 'foo'
