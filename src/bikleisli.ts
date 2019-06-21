/*
 *  Copyright 2019 Yuriy Bogomolov
 *
 *  Licensed under the Apache LicensVersion 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { Comonad1 } from 'fp-ts/lib/Comonad';
import { Either, fold, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { flow } from 'fp-ts/lib/function';
import { Kind, URIS } from 'fp-ts/lib/HKT';
import { Monad1 } from 'fp-ts/lib/Monad';
import { pipe } from 'fp-ts/lib/pipeable';

import { Distributes11 } from './Distributes';

/**
 * BiKleisli – an effectful function from `Find<F, A>` to `Kind<G, B>`.
 * For more intuition about Kleisli arrows please @see http://www.cse.chalmers.se/~rjmh/Papers/arrows.pdf
 *
 * @template A domain type
 * @template B codomain type
 */
export abstract class BiKleisli<F extends URIS, G extends URIS, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `BiKleisli`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `A`
   */
  abstract run(a: Kind<F, A>): Kind<G, B>;

  abstract W: Comonad1<F>;
  abstract M: Monad1<G>;
  abstract T: Distributes11<F, G>;

  /**
   * Applicative `ap` function.
   * Apply a lifted in `BiKleisli` context function to current value of `BiKleisli`.
   * @param fbc Function from `B` to `C`, lifted in the context of `BiKleisli`
   */
  ap<C>(fbc: BiKleisli<F, G, A, (b: B) => C>): BiKleisli<F, G, A, C> {
    return pure(this.W, this.M, this.T)((a) => this.M.ap(fbc.run(a), this.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `BiKleisli`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): BiKleisli<F, G, A, C> {
    return this.andThen(liftK(this.W, this.M, this.T)(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
   * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => BiKleisli<F, G, A, C>) {
    return pure(this.W, this.M, this.T)<A, C>((a) => this.M.chain(this.run(a), (b) => f(b).run(a)));
  }

  /**
   * Compose current `BiKleisli` with the next one.
   * @param that Sequential `BiKleisli` computation
   */
  andThen<C>(that: BiKleisli<F, G, B, C>): BiKleisli<F, G, A, C> {
    return composeK(this.W, this.M, this.T)(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `BiKleisli` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: BiKleisli<F, G, A, C>): (f: (t: [B, C]) => D) => BiKleisli<F, G, A, D> {
    return (f) => zipWith(this.W, this.M, this.T)<A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `BiKleisli` computation to run alongside with current
   */
  both<C>(that: BiKleisli<F, G, A, C>): BiKleisli<F, G, A, [B, C]> {
    return zipWith(this.W, this.M, this.T)<A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: BiKleisli<F, G, C, B>): BiKleisli<F, G, Either<A, C>, B> {
    return switchK(this.W, this.M, this.T)(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): BiKleisli<F, G, A, [B, A]> {
    return this.both(identity(this.W, this.M, this.T)<A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): BiKleisli<F, G, A, [A, B]> {
    return identity(this.W, this.M, this.T)<A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): BiKleisli<F, G, A, C> {
    return this.andThen(liftK(this.W, this.M, this.T)(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): BiKleisli<F, G, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): BiKleisli<F, G, A, A> {
    return this.first().andThen(snd(this.W, this.M, this.T)());
  }
}

/**
 * Specialized error type for Kleisli
 */
class KleisliError<E> extends Error {
  constructor(readonly error: E) { super(String(error)); }
}

/**
 * A pure functional computation from `A` to `Kind<F, B>`, which **never** throws in runtime.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Pure<F extends URIS, G extends URIS, A, B> extends BiKleisli<F, G, A, B> {
  readonly tag = 'Pure';
  constructor(
    readonly W: Comonad1<F>,
    readonly M: Monad1<G>,
    readonly T: Distributes11<F, G>,
    readonly _run: (a: Kind<F, A>) => Kind<G, B>,
  ) { super(); }

  run = (fa: Kind<F, A>): Kind<G, B> => this._run(fa);
}

/**
 * An impure effectful computation from `A` to `B`, which may throw an exception of type `E`
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Impure<F extends URIS, G extends URIS, A, B> extends BiKleisli<F, G, A, B> {
  readonly tag = 'Impure';
  constructor(
    readonly W: Comonad1<F>,
    readonly M: Monad1<G>,
    readonly T: Distributes11<F, G>,
    readonly _run: (a: A) => B,
  ) { super(); }

  run = (fa: Kind<F, A>): Kind<G, B> => this.M.of(this._run(this.W.extract(fa)));
}

/**
 * A right-to-left composition of two Kleisli functions.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Compose<F extends URIS, G extends URIS, A, B, C> extends BiKleisli<F, G, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly W: Comonad1<F>,
    readonly M: Monad1<G>,
    readonly T: Distributes11<F, G>,
    readonly f: BiKleisli<F, G, A, B>,
    readonly g: BiKleisli<F, G, B, C>,
  ) { super(); }

  run = (fa: Kind<F, A>): Kind<G, C> => this.M.chain(this.T(this.W.extend(fa, this.f.run)), (fb) => this.g.run(fb));
}

const isImpure = <F extends URIS, G extends URIS, A, B>(a: BiKleisli<F, G, A, B>): a is Impure<F, G, A, B> =>
  a.tag === 'Impure';

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export const pure = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(f: (a: Kind<F, A>) => Kind<G, B>): BiKleisli<F, G, A, B> => new Pure<F, G, A, B>(W, M, T, f);

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export const impure = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => new Impure(W, M, T, (a: A) => {
    try {
      return f(a);
    } catch (error) {
      if (catcher(error) !== undefined) {
        throw new KleisliError<E>(catcher(error));
      }
      throw error;
    }
  });

const voidCatcher = (e: Error): never => { throw e; };

/**
 * Create a new `BiKleisli` computation from impure function which *you know* to never throw exceptions,
 * or throw exceptions which should lead to termination fo the program.
 * @param f Impure computation from `A` to `B`
 */
export const impureVoid = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => impure(W, M, T)(voidCatcher)(f);

/**
 * Lift the impure computation into `BiKleisli` context.
 * @param f Impure function from `A` to `B`
 */
export const liftK = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => new Impure(W, M, T, f);

/**
 * Monadic `chain` function.
 * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
 * @param fa Basic Kleisli computation
 * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation
 */
export const chain = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(fa: BiKleisli<F, G, A, B>, f: (b: B) => BiKleisli<F, G, A, C>): BiKleisli<F, G, A, C> =>
    pure(W, M, T)<A, C>((a) => M.chain(fa.run(a), (b) => f(b).run(a)));

/**
 * Create a new `BiKleisli` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export const point = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(b: () => B): BiKleisli<F, G, A, B> => liftK(W, M, T)(b);

/**
 * Applicative `of` function.
 * Lift a value of type `B` into a context of `BiKleisli`.
 * @param b Value of type `B`
 */
export const of = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(b: B): BiKleisli<F, G, A, B> => liftK(W, M, T)(() => b);

/**
 * Tuple swap, lifted in `BiKleisli` context.
 */
export const swap = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], [B, A]> => liftK(W, M, T)(([a, b]) => [b, a]);

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export const composeK = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(second: BiKleisli<F, G, B, C>, first: BiKleisli<F, G, A, B>): BiKleisli<F, G, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(W, M, T, flow(first._run, second._run)) :
      new Compose(W, M, T, first, second);

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export const pipeK = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(first: BiKleisli<F, G, A, B>, second: BiKleisli<F, G, B, C>): BiKleisli<F, G, A, C> =>
    composeK(W, M, T)(second, first);

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export const switchK = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(l: BiKleisli<F, G, A, B>, r: BiKleisli<F, G, C, B>): BiKleisli<F, G, Either<A, C>, B> =>
    isImpure(l) && isImpure(r) ?
      new Impure<F, G, Either<A, C>, B>(W, M, T, (ac) => pipe(
        ac,
        fold(
          (a) => l._run(a),
          (c) => r._run(c),
        )),
      ) :
      pure(W, M, T)(
        (fac) => pipe(
          fac,
          W.extract,
          fold(
            (a) => l.run(W.extend(fac, () => a)),
            (c) => r.run(W.extend(fac, () => c)),
          ),
        ),
      );

/**
 * Execute `l` and `r` computations and if both succeed, process the results with `f`.
 * @param l First `BiKleisli` computation
 * @param r Second `BiKleisli` computation
 * @param f Function to process the results of both computations
 */
export const zipWith = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C, D>(l: BiKleisli<F, G, A, B>, r: BiKleisli<F, G, A, C>) =>
    (f: (t: [B, C]) => D): BiKleisli<F, G, A, D> =>
      isImpure(l) && isImpure(r) ?
        new Impure<F, G, A, D>(W, M, T, (a) => f([l._run(a), r._run(a)])) :
        pure(W, M, T)((a) => M.chain(l.run(a), (b) => M.map(r.run(a), (c) => f([b, c]))));

/**
 * Propagate the input unchanged.
 */
export const identity = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A>(): BiKleisli<F, G, A, A> => liftK(W, M, T)((x) => x);

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export const left = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(k: BiKleisli<F, G, A, B>): BiKleisli<F, G, Either<A, C>, Either<B, C>> =>
    isImpure(k) ?
      new Impure(W, M, T, (ac) => pipe(ac, fold(
        (a) => eitherLeft(k._run(a)),
        (c) => eitherRight(c),
      ))) :
      pure(W, M, T)((fac) => pipe(
        fac,
        W.extract,
        fold(
          (a) => M.map(k.run(W.extend(fac, () => a)), (x) => eitherLeft(x)),
          (c) => M.of(eitherRight(c)),
        ),
      ));

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export const right = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B, C>(k: BiKleisli<F, G, A, B>): BiKleisli<F, G, Either<C, A>, Either<C, B>> =>
    isImpure(k) ?
      new Impure(W, M, T, (a) => pipe(a, fold(
        (l) => eitherLeft(l),
        (r) => eitherRight(k._run(r)),
      ))) :
      pure(W, M, T)((fca) => pipe(
        fca,
        W.extract,
        fold(
          (a) => M.of(eitherLeft(a)),
          (c) => M.map(k.run(W.extend(fca, () => c)), (x) => eitherRight(x)),
        ),
      ));

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export const test = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>): BiKleisli<F, G, A, Either<A, A>> =>
    cond.both(identity(W, M, T)()).andThen(liftK(W, M, T)(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export const ifThenElse = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(cond: BiKleisli<F, G, A, boolean>) =>
    (then: BiKleisli<F, G, A, B>) => (else_: BiKleisli<F, G, A, B>): BiKleisli<F, G, A, B> =>
      isImpure(cond) && isImpure(then) && isImpure(else_) ?
        new Impure(W, M, T, (a) => cond._run(a) ? then._run(a) : else_._run(a)) :
        test(W, M, T)(cond).andThen(switchK(W, M, T)(then, else_));

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export const ifThen = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>) =>
    (then: BiKleisli<F, G, A, A>): BiKleisli<F, G, A, A> => ifThenElse(W, M, T)<A, A>(cond)(then)(identity(W, M, T)());

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `false`
 */
export const whileDo = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>) => (body: BiKleisli<F, G, A, A>): BiKleisli<F, G, A, A> => {
    if (isImpure(cond) && isImpure(body)) {
      return new Impure<F, G, A, A>(
        W,
        M,
        T,
        (a0) => {
          let a = a0;

          while (cond._run(a)) {
            a = body._run(a);
          }

          return a;
        },
      );
    } else {
      const loop = (): BiKleisli<F, G, A, A> =>
        pure(W, M, T)<A, A>((fa) => M.chain(cond.run(fa), (b) => b ? body.run(fa) : M.of(W.extract(fa))));

      return loop();
    }
  };

/**
 * Lifted version of `fst` tuple function.
 */
export const fst = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], A> => liftK(W, M, T)(([a]) => a);

/**
 * Lifted version of `snd` tuple function.
 */
export const snd = <F extends URIS, G extends URIS>(W: Comonad1<F>, M: Monad1<G>, T: Distributes11<F, G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], B> => liftK(W, M, T)(([, b]) => b);

/**
 * Convenience method which retruns instances of Kleisli API for the given monad.
 * @param M Monad1 & Bifunctor instance
 */
export const getInstancesFor = <F extends URIS, G extends URIS>(
  W: Comonad1<F>,
  M: Monad1<G>,
  T: Distributes11<F, G>,
) => ({
  /**
   * Applicative `of` function.
   * Lift a value of type `B` into a context of `BiKleisli`.
   * @param b Value of type `B`
   */
  of: of(W, M, T),
  /**
   * Create a new instance of `Pure` computation.
   * @param f Function to run
   */
  pure: pure(W, M, T),
  /**
   * Create a new instance of `Impure` computation.
   * @param catcher Function to transform the error from `Error` into `E`
   * @param f Impure computation from `A` to `B` which may throw
   */
  impure: impure(W, M, T),
  /**
   * Create a new `BiKleisli` computation from impure function which *you know* to never throw exceptions,
   * or throw exceptions which should lead to termination fo the program.
   * @param f Impure computation from `A` to `B`
   */
  impureVoid: impureVoid(W, M, T),
  /**
   * Lift the impure computation into `BiKleisli` context.
   * @param f Impure function from `A` to `B`
   */
  liftK: liftK(W, M, T),
  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `BiKleisli<F, G, A, B>`, determining the next flow of computations.
   * @param fa Basic Kleisli computation
   * @param f Function from `B` to `BiKleisli<F, G, A, C>`, which represents next sequential computation
   */
  chain: chain(W, M, T),
  /**
   * Create a new `BiKleisli` computation which result in `b`.
   * @param b Lazy value of type `B`
   */
  point: point(W, M, T),
  /**
   * Tuple swap, lifted in `BiKleisli` context.
   */
  swap: swap(W, M, T),
  /**
   * Perform right-to-left Kleisli arrows compotions.
   * @param second Second computation to apply
   * @param first First computation to apply
   */
  composeK: composeK(W, M, T),
  /**
   * Perform left-to-right Kleisli arrows compotions.
   * @param first First computation to apply
   * @param second Second computation to apply
   */
  pipeK: pipeK(W, M, T),
  /**
   * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
   * @param l Left branch of computation
   * @param r Right branch of computation
   */
  switchK: switchK(W, M, T),
  /**
   * Execute `l` and `r` computations and if both succeed, process the results with `f`.
   * @param l First `BiKleisli` computation
   * @param r Second `BiKleisli` computation
   * @param f Function to process the results of both computations
   */
  zipWith: zipWith(W, M, T),
  /**
   * Propagate the input unchanged.
   */
  identity: identity(W, M, T),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see right.
   * @param k Computation from `A` to `B`
   */
  left: left(W, M, T),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see left.
   * @param k Computation from `A` to `B`
   */
  right: right(W, M, T),
  /**
   * Depending on the condition, propagate the original input through the left or right part of `Either`.
   * @param cond Predicate for `A`
   */
  test: test(W, M, T),
  /**
   * Depending on the condition, execute either `then` or `else`.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   * @param else_ Computation to run if `cond` is `false`
   */
  ifThenElse: ifThenElse(W, M, T),
  /**
   * Simplified version of @see ifThenElse without the `else` part.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   */
  ifThen: ifThen(W, M, T),
  /**
   * While-loop: run `body` until `cond` is `true`.
   * @param cond Predicate for `A`
   * @param body Computation to run continuously until `cond` is `false`
   */
  whileDo: whileDo(W, M, T),
  /**
   * Lifted version of `fst` tuple function.
   */
  fst: fst(W, M, T),
  /**
   * Lifted version of `snd` tuple function.
   */
  snd: snd(W, M, T),
});

export default getInstancesFor;
