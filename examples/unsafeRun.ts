import { ioEither, URI as IOEitherURI } from 'fp-ts/lib/IOEither';

import { getInstancesFor, KleisliIO } from '../src';
import { unsafeRunIE } from '../src/unsafe';

const { impureVoid, liftK } = getInstancesFor(ioEither);

const k: KleisliIO<IOEitherURI, Error, void, string> = liftK(() => {
  if (Math.random() > 0.5) {
    throw new Error('oops');
  }
  return 'foo';
});
const log: KleisliIO<IOEitherURI, never, string, void> = impureVoid((s) => console.log(s));

unsafeRunIE(k.andThen(log).run()); // 🤞🏻 hope it doesn't blow up and prints 'foo'
