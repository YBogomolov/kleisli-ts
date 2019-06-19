import { Comonad2 } from 'fp-ts/lib/Comonad';
import { compose } from 'fp-ts/lib/function';
import { Kind2, URIS2 } from 'fp-ts/lib/HKT';

export abstract class CoKleisli<F extends URIS2, E, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';
  abstract run(wa: Kind2<F, E, A>): B;

  abstract W: Comonad2<F>;
}

class Pure<F extends URIS2, E, A, B> extends CoKleisli<F, E, A, B> {
  readonly tag = 'Pure';
  constructor(readonly W: Comonad2<F>, readonly _run: (wa: Kind2<F, E, A>) => B) { super(); }

  run = (wa: Kind2<F, E, A>): B => this._run(wa);
}

class Impure<F extends URIS2, E, A, B> extends CoKleisli<F, E, A, B> {
  readonly tag = 'Impure';
  constructor(readonly W: Comonad2<F>, readonly _run: (a: A) => B) { super(); }

  run = (wa: Kind2<F, E, A>): B => this._run(this.W.extract(wa));
}

class Compose<F extends URIS2, E, A, B, C> extends CoKleisli<F, E, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly W: Comonad2<F>,
    readonly g: CoKleisli<F, E, B, C>,
    readonly f: CoKleisli<F, E, A, B>,
  ) { super(); }

  run = (wa: Kind2<F, E, A>): C => this.g.run(this.W.extend(wa, this.f.run));
}

const isImpure = <F extends URIS2, E, A, B>(a: CoKleisli<F, E, A, B>): a is Impure<F, E, A, B> => a.tag === 'Impure';

export const pure = <F extends URIS2>(W: Comonad2<F>) =>
  <E, A, B>(f: (wa: Kind2<F, E, A>) => B): CoKleisli<F, E, A, B> => new Pure<F, E, A, B>(W, f);

export const composeK = <F extends URIS2>(W: Comonad2<F>) =>
  <E, A, B, C>(second: CoKleisli<F, E, B, C>, first: CoKleisli<F, E, A, B>): CoKleisli<F, E, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(W, compose(second._run, first._run)) :
      new Compose(W, second, first);
